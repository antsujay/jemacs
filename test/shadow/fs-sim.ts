import { MemCas, sha256 } from "../../src/shadow/cas"
import type { ManifestEntry, ShadowOp } from "../../src/shadow/ops"
import { FakeLink, type Adversary, type Rng } from "./fake-link"
import { FakeFs, S_IFDIR, dirname, type FsChange } from "./fake-fs"
import { subscribe, type FakeWatcher } from "./fake-watcher"
import { SeededRng } from "./sim"

export type { Adversary } from "./fake-link"

/**
 * FS-replica DST sim — same shape as `Simulator` (sim.ts), one layer up.
 *
 * A is the authority filesystem (FakeFs + FakeWatcher). S is the shadow's
 * view: a lazy manifest cache, a bounded CAS, the set of directories S has
 * visited, and the set of buffers S has open. They talk over a FakeLink pair
 * carrying ManifestReq/ManifestTree/ManifestDelta/Want/Chunk/Cmd ops.
 *
 * A's handler is fully implemented here — it just reads truth from FakeFs and
 * answers. S's handler (`applyManifestOp`) is the unit under test: it's a
 * **stub** until the manifest reconciliation lands in src/shadow/, so every
 * property test in fs-sim.prop.test.ts is `test.failing` by construction.
 *
 * Invariants checked after `drain()` (DESIGN.md §Coherence failure modes):
 *   1. open buffers: S.open[path].content === A.fs(path), or marked stale
 *   2. visited subtrees: for each dir ∈ S.visited, S.manifest|dir ≡ A.fs|dir
 *   3. CAS integrity: ∀ sha ∈ S.cas, sha256(cas.lookup(sha)) === sha
 *   4. CAS bound: Σ |content| ≤ casMaxBytes
 *   5. post-heartbeat convergence: after heartbeat, (1) and (2) hold strictly
 */

// ── S-side state ────────────────────────────────────────────────────────────

interface OpenBuf {
  content: string
  /** sha S believes A has on disk — stale-base check on save. */
  baseSha: string
  /** S has local edits not yet saved. */
  dirty: boolean
  /** S knows content may lag A (manifest delta arrived, or sync in flight). */
  stale: boolean
}

export interface ShadowFsState {
  manifest: Map<string, ManifestEntry>
  cas: MemCas
  /** Shas written to `cas` — MemCas doesn't expose iteration. */
  casShas: Set<string>
  visited: Set<string>
  open: Map<string, OpenBuf>
  casMaxBytes: number
}

function casWrite(S: ShadowFsState, text: string): string {
  const sha = S.cas.write(text)
  S.casShas.add(sha)
  // Evict to ≤ 0.8×cap when over; keep `casShas` in sync so invariant 3 holds.
  const all = [...S.cas.entries()]
  let total = all.reduce((n, e) => n + e.size, 0)
  if (total > S.casMaxBytes) {
    all.sort((a, b) => a.atime - b.atime)
    const target = Math.floor(S.casMaxBytes * 0.8)
    for (const e of all) {
      if (total <= target) break
      S.cas.delete(e.sha)
      S.casShas.delete(e.sha)
      total -= e.size
    }
  }
  return sha
}

// ── Actions ─────────────────────────────────────────────────────────────────

export type FsAction =
  | { k: "find-file"; path: string }
  | { k: "dired"; dir: string }
  | { k: "save-buffer"; path: string; edit: string }
  | { k: "kill-buffer"; path: string }
  | { k: "ext-write"; path: string; content: string }
  | { k: "ext-delete"; path: string }
  | { k: "partition" }
  | { k: "heal" }
  | { k: "tick"; n: number }

export interface FsSimulatorOpts {
  adversary?: Partial<Adversary>
  watcherMissP?: number
  watcherDelayMax?: number
  casMaxBytes?: number
  /** Seed tree on A before the run. Paths ending in "/" are dirs. */
  initialTree?: Record<string, string>
}

const DEFAULT_TREE: Record<string, string> = {
  "/src/": "",
  "/src/a.ts": "export const a = 1\n",
  "/src/b.ts": "export const b = 2\n",
  "/lib/": "",
  "/lib/util.ts": "export function util() {}\n",
  "/README.md": "# readme\n",
}

const EXT_CHARS = "VWXYZ"

// ── FsSimulator ─────────────────────────────────────────────────────────────

export class FsSimulator {
  readonly fs: FakeFs
  readonly watcher: FakeWatcher
  readonly S: ShadowFsState
  readonly sLink: FakeLink
  readonly aLink: FakeLink
  readonly rng: SeededRng
  readonly trace: FsAction[] = []
  readonly opts: FsSimulatorOpts
  stepN = 0

  constructor(readonly seed: number, opts: FsSimulatorOpts = {}) {
    this.opts = opts
    this.rng = new SeededRng(seed)

    this.fs = new FakeFs()
    for (const [p, c] of Object.entries(opts.initialTree ?? DEFAULT_TREE)) {
      if (p.endsWith("/")) this.fs.mkdir(p.slice(0, -1), { recursive: true })
      else { this.fs.mkdir(dirname(p), { recursive: true }); this.fs.writeFile(p, c) }
    }

    this.S = {
      manifest: new Map(),
      cas: new MemCas(),
      casShas: new Set(),
      visited: new Set(),
      open: new Map(),
      casMaxBytes: opts.casMaxBytes ?? 64 * 1024,
    }

    // Separate rngs so link/watcher draws don't perturb genAction's stream.
    const linkRng = new SeededRng((seed ^ 0x9e3779b9) >>> 0)
    const watchRng: Rng = new SeededRng((seed ^ 0x7f4a7c15) >>> 0)
    const { sLink, aLink } = FakeLink.pair({ rng: linkRng, adversary: opts.adversary })
    this.sLink = sLink
    this.aLink = aLink

    aLink.on(op => this.onAOp(op))
    sLink.on(op => this.onSOp(op))

    this.watcher = subscribe(
      this.fs,
      { delayMax: opts.watcherDelayMax ?? 2, missP: opts.watcherMissP ?? 0, rng: watchRng },
      c => this.onWatcherEvent(c),
    )
  }

  // ── Generators ────────────────────────────────────────────────────────────

  step(): FsAction {
    this.stepN++
    const a = this.genAction()
    this.trace.push(a)
    this.apply(a)
    return a
  }

  run(n: number): void {
    for (let i = 0; i < n; i++) this.step()
    this.drain()
  }

  private genAction(): FsAction {
    const r = this.rng
    const roll = r.int(20)
    if (roll < 9) return this.genFsOp()
    if (roll < 13) return this.genFsExt()
    if (roll < 18) return { k: "tick", n: 1 + r.int(4) }
    return this.sLink.partitioned ? { k: "heal" } : { k: "partition" }
  }

  /** S-side user action: find-file / dired / save-buffer / kill-buffer. */
  genFsOp(): FsAction {
    const r = this.rng
    const files = this.fs.paths()
    const dirs = this.fs.dirs()
    const open = [...this.S.open.keys()]
    switch (r.int(4)) {
      case 0: return { k: "find-file", path: files.length ? r.pick(files) : "/README.md" }
      case 1: return { k: "dired", dir: r.pick(dirs) }
      case 2: {
        const path = open.length ? r.pick(open) : (files.length ? r.pick(files) : "/README.md")
        const edit = EXT_CHARS[r.int(EXT_CHARS.length)]!
        return { k: "save-buffer", path, edit }
      }
      default: {
        if (!open.length) return { k: "find-file", path: files.length ? r.pick(files) : "/README.md" }
        return { k: "kill-buffer", path: r.pick(open) }
      }
    }
  }

  /** External mutation on A's filesystem (another process / git checkout). */
  genFsExt(): FsAction {
    const r = this.rng
    const files = this.fs.paths()
    if (r.int(4) === 0 && files.length > 1) return { k: "ext-delete", path: r.pick(files) }
    // Mostly rewrite an existing file; sometimes a fresh path so manifest grows.
    const path = files.length && r.int(4) > 0
      ? r.pick(files)
      : `${r.pick(this.fs.dirs())}/ext${this.stepN}.txt`.replace("//", "/")
    const content = Array.from({ length: 1 + r.int(3) }, () => EXT_CHARS[r.int(EXT_CHARS.length)]).join("")
    return { k: "ext-write", path, content }
  }

  // ── Apply ─────────────────────────────────────────────────────────────────

  apply(a: FsAction): void {
    switch (a.k) {
      case "find-file": {
        const entry = this.S.manifest.get(a.path)
        const cached = entry ? this.S.cas.lookup(entry.sha) : undefined
        const buf: OpenBuf = entry && cached !== undefined
          ? { content: cached, baseSha: entry.sha, dirty: false, stale: false }
          : { content: "", baseSha: "", dirty: false, stale: true }
        this.S.open.set(a.path, buf)
        if (!entry) this.sLink.send({ kind: "manifest-req", dir: dirname(a.path) })
        if (entry && cached === undefined) this.sLink.send({ kind: "want", id: a.path })
        this.S.visited.add(dirname(a.path))
        break
      }
      case "dired": {
        if (!this.S.visited.has(a.dir)) {
          this.S.visited.add(a.dir)
          this.sLink.send({ kind: "manifest-req", dir: a.dir })
        }
        break
      }
      case "save-buffer": {
        let buf = this.S.open.get(a.path)
        if (!buf) { this.apply({ k: "find-file", path: a.path }); buf = this.S.open.get(a.path)! }
        buf.content += a.edit
        buf.dirty = true
        const sha = casWrite(this.S, buf.content)
        // A will writeFile + watcher will report it; S learns the new manifest via delta.
        this.sLink.send({ kind: "command", name: "write-file", args: [a.path, buf.content], seq: 0 })
        buf.baseSha = sha
        buf.dirty = false
        buf.stale = true
        break
      }
      case "kill-buffer":
        this.S.open.delete(a.path)
        break
      case "ext-write":
        this.fs.mkdir(dirname(a.path), { recursive: true })
        this.fs.writeFile(a.path, a.content)
        break
      case "ext-delete":
        if (this.fs.exists(a.path)) this.fs.unlink(a.path)
        break
      case "partition":
        this.sLink.partitioned = this.aLink.partitioned = true
        break
      case "heal":
        this.sLink.partitioned = this.aLink.partitioned = false
        break
      case "tick":
        this.watcher.tick(a.n)
        this.aLink.tick(a.n)
        this.sLink.tick(a.n)
        break
    }
  }

  // ── A-side: serve truth ───────────────────────────────────────────────────

  /** Watcher delivered a change on A → push a manifest delta to S. The event
   *  is just a "this path changed" signal — re-stat at delivery time, since a
   *  delayed `create` may refer to a path that's since been deleted. */
  private onWatcherEvent(c: FsChange): void {
    const change = this.fs.exists(c.path)
      ? { path: c.path, new: this.manifestEntry(c.path) }
      : { path: c.path, old: undefined as string | undefined }
    this.aLink.send({ kind: "manifest-delta", changes: [change] })
  }

  private manifestEntry(path: string): ManifestEntry {
    const st = this.fs.stat(path)
    const sha = st.mode & S_IFDIR ? "" : sha256(st.content)
    return { path, sha, mode: st.mode, size: st.content.length, mtime: st.mtime }
  }

  /** A receives an op from S over the link. */
  private onAOp(op: ShadowOp): void {
    switch (op.kind) {
      case "manifest-req": {
        if (!this.fs.isDir(op.dir)) return
        const entries = this.fs.readdir(op.dir).map(name => {
          const p = op.dir === "/" ? `/${name}` : `${op.dir}/${name}`
          return this.manifestEntry(p)
        })
        this.aLink.send({ kind: "manifest-tree", root: "", dir: op.dir, entries })
        return
      }
      case "want": {
        if (!this.fs.exists(op.id) || this.fs.isDir(op.id)) return
        const text = this.fs.readFile(op.id)
        this.aLink.send({ kind: "chunk", id: op.id, offset: 0, data: text, eof: true })
        return
      }
      case "command": {
        if (op.name === "write-file") {
          const [path, content] = op.args as [string, string]
          this.fs.mkdir(dirname(path), { recursive: true })
          this.fs.writeFile(path, content)
        }
        return
      }
      default:
        return
    }
  }

  // ── S-side: apply manifest ops ────────────────────────────────────────────

  /** S receives an op from A. */
  private onSOp(op: ShadowOp): void {
    this.applyManifestOp(this.S, op)
  }

  applyManifestOp(S: ShadowFsState, op: ShadowOp): void {
    switch (op.kind) {
      case "manifest-tree": {
        // Full replace of `op.dir`'s listing — clears stale deletions too.
        for (const p of [...S.manifest.keys()]) {
          if (dirname(p) === op.dir) S.manifest.delete(p)
        }
        for (const e of op.entries) S.manifest.set(e.path, e)
        // Any open file in this dir: refresh from CAS (hit) or want it (miss);
        // a path absent from the listing is gone on A.
        for (const [path, buf] of S.open) {
          if (dirname(path) !== op.dir) continue
          this.refreshOpen(S, path, buf)
        }
        return
      }
      case "manifest-delta": {
        for (const c of op.changes) {
          const dir = dirname(c.path)
          // Lazy manifest: ignore deltas for dirs S hasn't visited — the first
          // manifest-tree will carry the fresh listing.
          if (!S.visited.has(dir)) continue
          if (c.new) S.manifest.set(c.path, c.new)
          else S.manifest.delete(c.path)
          const buf = S.open.get(c.path)
          if (buf) buf.stale = true
        }
        return
      }
      case "chunk": {
        // A's onAOp ships single eof chunks; no reassembly needed here.
        const sha = casWrite(S, op.data)
        const buf = S.open.get(op.id)
        if (buf) {
          buf.content = op.data
          buf.baseSha = sha
          buf.stale = false
        }
        return
      }
      default:
        return
    }
  }

  /** Reconcile one open buffer against S.manifest: CAS hit → adopt; miss → want;
   *  no entry → file is gone on A. */
  private refreshOpen(S: ShadowFsState, path: string, buf: OpenBuf): void {
    const e = S.manifest.get(path)
    if (!e) {
      buf.content = ""
      buf.baseSha = ""
      buf.stale = false
      return
    }
    const cached = S.cas.lookup(e.sha)
    if (cached !== undefined) {
      buf.content = cached
      buf.baseSha = e.sha
      buf.stale = false
    } else {
      buf.stale = true
      this.sLink.send({ kind: "want", id: path })
    }
  }

  // ── Drain + heartbeat ─────────────────────────────────────────────────────

  /** Heal, flush watcher and both link directions until quiescent, then run a
   *  heartbeat (full root resync — DESIGN.md: repairs missed watcher events). */
  drain(): void {
    this.sLink.partitioned = this.aLink.partitioned = false
    const pump = () => {
      this.watcher.drain()
      while (this.aLink.inflight.length || this.sLink.inflight.length) {
        this.aLink.drainSide()
        this.sLink.drainSide()
      }
    }
    pump()
    this.heartbeat()
    pump()
  }

  /** Re-request every visited subtree — the resync that papers over watcher misses. */
  heartbeat(): void {
    for (const dir of this.S.visited) this.sLink.send({ kind: "manifest-req", dir })
    for (const path of this.S.open.keys()) this.sLink.send({ kind: "want", id: path })
  }

  // ── Invariants ────────────────────────────────────────────────────────────

  checkInvariant(): void {
    // 3. CAS integrity — independent of manifest state.
    let casBytes = 0
    for (const sha of this.S.casShas) {
      const text = this.S.cas.lookup(sha)
      if (text === undefined) throw this.fail(`CAS: sha ${sha.slice(0, 12)} missing`)
      if (sha256(text) !== sha) throw this.fail(`CAS: sha mismatch for ${sha.slice(0, 12)}`)
      casBytes += text.length
    }
    // 4. CAS bound.
    if (casBytes > this.S.casMaxBytes) {
      throw this.fail(`CAS: ${casBytes}B > cap ${this.S.casMaxBytes}B`)
    }
    // 1 + 5. Open buffers match A (drain() ran a heartbeat, so no stale exemption).
    for (const [path, buf] of this.S.open) {
      const truth = this.fs.exists(path) && !this.fs.isDir(path) ? this.fs.readFile(path) : undefined
      if (buf.content !== (truth ?? "")) {
        throw this.fail(`open[${path}]: S=${JSON.stringify(buf.content)} A=${JSON.stringify(truth)}`)
      }
      if (buf.stale) throw this.fail(`open[${path}]: still marked stale after heartbeat`)
    }
    // 2 + 5. Visited subtrees: S.manifest|dir ≡ A.fs|dir.
    for (const dir of this.S.visited) {
      if (!this.fs.isDir(dir)) continue
      const want = new Map(this.fs.readdir(dir).map(name => {
        const p = dir === "/" ? `/${name}` : `${dir}/${name}`
        return [p, this.fs.isDir(p) ? "" : sha256(this.fs.readFile(p))]
      }))
      for (const [p, sha] of want) {
        const got = this.S.manifest.get(p)
        if (!got || got.sha !== sha) {
          throw this.fail(`manifest[${dir}]: ${p} S.sha=${got?.sha?.slice(0, 12) ?? "∅"} A.sha=${sha.slice(0, 12)}`)
        }
      }
      for (const [p] of this.S.manifest) {
        if (dirname(p) === dir && !want.has(p)) {
          throw this.fail(`manifest[${dir}]: ${p} present in S but deleted on A`)
        }
      }
    }
  }

  private fail(msg: string): Error {
    const start = Math.max(0, this.trace.length - 30)
    const tail = this.trace.slice(start).map((a, i) => `  [${start + i}] ${JSON.stringify(a)}`).join("\n")
    const o = this.opts
    const optBits = [
      o.adversary && `adversary:${JSON.stringify(o.adversary)}`,
      o.watcherMissP && `watcherMissP:${o.watcherMissP}`,
    ].filter(Boolean).join(", ")
    return new Error(
      `seed=${this.seed} step=${this.stepN}: ${msg}\n` +
      `repro: new FsSimulator(${this.seed}${optBits ? `, {${optBits}}` : ""}).run(${this.stepN})\n` +
      `last ${this.trace.length - start} actions:\n${tail}`,
    )
  }
}
