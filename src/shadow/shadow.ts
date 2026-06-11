import type { Editor } from "../kernel/editor"
import { BufferModel } from "../kernel/buffer"
import { getPlatformRuntime, setPlatformRuntime, type PlatformRuntime } from "../platform/runtime"
import { applyRemoteOp, type ShadowLink } from "./link"
import { buildManifest, dirHash, dirname, type FsLike, type ManifestEntry } from "./manifest"
import { advancePast, transformPast, type Cmd, type ManifestDelta, type Point, type Seq, type ShadowOp, type Splice } from "./ops"
import { chunkText, diffText, FileCas, sha256, type Cas } from "./cas"
import { createAuthorityFs, type AuthorityFs, type FsWatcher, type RemoteRuntime } from "./remote-runtime"

export type { ShadowLink } from "./link"
export type { ShadowOp, Splice, Seq } from "./ops"

/** Third arg to attach{Shadow,Authority}. `onDispose` kept at top level so the
 *  pre-CAS call shape `attachX(editor, link, ctx)` still typechecks. */
export type AttachOpts = {
  onDispose?(fn: () => void): void
  cas?: Cas
  /** S-side: install this as the process `PlatformRuntime` so `find-file` /
   *  `save-buffer` / `dired` route through manifest+CAS instead of node:fs.
   *  Process-global by design — one S per process; A serves via `fs` below. */
  runtime?: Partial<PlatformRuntime>
  /** A-side: serve `manifest-req` / `want` from this instead of node:fs. */
  fs?: FsLike
  /** A-side: subscribe for change events → push `ManifestDelta` to S. */
  watcher?: FsWatcher
  /** A-side: root for `watcher`'s manifest rebuild. */
  fsRoot?: string
  /** A-side: debounce-flush externals this many ms after the last S op (or the
   *  ext itself). ≤0 disables the timer — DST sim drives flushExternal directly. */
  flushMs?: number
  /** A-side: force-flush externals after this many acks even if S never goes
   *  quiet, so a hot S can't defer the rebase forever. */
  flushEveryN?: number
}

/** S→A ops that carry a seq and are subject to in-order buffering on A. */
type SeqOp = Splice | Point | Cmd

/** A shipped splice plus the undo-tree seq it left the buffer at. */
type SentSplice = Splice & { bufSeq: number }

/** Per-buffer cap on `ShadowState.sent`. Ack alone can't safely prune (a
 *  reordered rebase needs entries the ack would drop — t-f360d582), so memory
 *  is bounded by evicting the oldest entry once the cap is hit. The evicted
 *  entry's bufSeq folds into `baseBufSeq`, which is correct as long as no
 *  rebase arrives with `baseSeq` older than the cap-ago op — comfortably true
 *  for ordered transports and the DST adversary's small reorder window. */
export const MAX_SENT = 256

// ── State stashed in editor.locals ──────────────────────────────────────────

export type ShadowState = {
  link: ShadowLink
  cas: Cas
  /** Set when `opts.runtime` is a `RemoteRuntime` — manifest/chunk ops forward here. */
  runtime?: RemoteRuntime
  nextSeq: Seq
  /** Ops sent to A, not yet ack'd. Each list is also mirrored to buffer.locals["shadow-pending"] for display. */
  pending: Map<string, Splice[]>
  /** Every shipped splice with the buf.seq it left S at. Survives ack (a rebase
   *  reordered behind its ack still needs the rewind target — t-f360d582);
   *  capped at `MAX_SENT` on push and replaced wholesale on rebase. */
  sent: Map<string, SentSplice[]>
  /** buf.seq at the synced base (wire-seq ≤ last rebase's baseSeq). */
  baseBufSeq: Map<string, number>
  /** Chunk reassembly: bufferId → {offset → slice, eofAt}. Assembled once a
   *  contiguous run from 0 reaches eofAt; tolerant of reorder + dup. */
  partial: Map<string, { chunks: Map<number, string>; eofAt?: number }>
  /** Buffer id A asked S to display. Stashed so a `switch-to-buffer` Cmd that
   *  races ahead of its `buffer-ref` (async CAS lookup) still lands once the
   *  buffer materializes. */
  wantCurrent?: string
}

export type AuthorityState = {
  link: ShadowLink
  cas: Cas
  /** Set when `opts.fs` was given — manifest-req / non-buffer want forward here. */
  fs?: AuthorityFs
  /** Reliability layer: highest contiguous seq received from S (global, dedup hwm). */
  recvSeq: Seq
  /** Reliability layer: out-of-order ops parked until their predecessor arrives. */
  held: Map<Seq, SeqOp>
  /** Highest seq from S applied per buffer; rebase.baseSeq comes from here. */
  lastSeq: Map<string, Seq>
  /** Splices that landed on A from somewhere other than S since lastSeq[bufferId].
   *  Kept in S's frame: advanced past each applied S op so flushExternal can ship
   *  them as a rebase at baseSeq=lastSeq with no rewind needed on S. */
  external: Map<string, Splice[]>
  /** Deferred-rebase trigger: debounce timer armed whenever `external` is
   *  non-empty, reset on each S op, fired `flushMs` after the last. */
  flushMs: number
  flushEveryN: number
  acksSinceFlush: number
  flushTimer?: ReturnType<typeof setTimeout>
}

const SHADOW_KEY = "shadow"
const AUTHORITY_KEY = "shadow-authority"
const PENDING_KEY = "shadow-pending"

export function shadowState(editor: Editor): ShadowState | undefined {
  return editor.locals.get(SHADOW_KEY) as ShadowState | undefined
}

export function authorityState(editor: Editor): AuthorityState | undefined {
  return editor.locals.get(AUTHORITY_KEY) as AuthorityState | undefined
}

/** Run `fn` with `buf.onSplice` suppressed so kernel-level mutations don't echo over the link. */
function withoutEmit<T>(buf: BufferModel, fn: () => T): T {
  const prev = buf.onSplice
  buf.onSplice = undefined
  try { return fn() } finally { buf.onSplice = prev }
}

/** Duck-type check for `RemoteRuntime` — `opts.runtime` is typed as the base
 *  `PlatformRuntime` so a plain stub (browser phase-5) also fits. */
function isRemoteRuntime(rt: Partial<PlatformRuntime>): rt is RemoteRuntime {
  return typeof (rt as RemoteRuntime).onOp === "function"
    && typeof (rt as RemoteRuntime).bindSeq === "function"
}

function setPending(editor: Editor, state: ShadowState, bufferId: string, list: Splice[]): void {
  state.pending.set(bufferId, list)
  editor.buffers.get(bufferId)?.locals.set(PENDING_KEY, list)
}

// ── Shadow side (S) ─────────────────────────────────────────────────────────

export function attachShadow(editor: Editor, link: ShadowLink, opts?: AttachOpts): () => void {
  const state: ShadowState = { link, cas: opts?.cas ?? new FileCas(), nextSeq: 1, pending: new Map(), sent: new Map(), baseBufSeq: new Map(), partial: new Map() }
  editor.locals.set(SHADOW_KEY, state)

  const restore: Array<() => void> = []
  if (opts?.runtime) {
    const rt = opts.runtime
    if (isRemoteRuntime(rt)) {
      state.runtime = rt
      // Share the seq counter so runtime-issued Cmds interleave with splices
      // under A's single in-order reliability buffer.
      rt.bindSeq(() => state.nextSeq++)
    }
    const prev = getPlatformRuntime()
    setPlatformRuntime(rt)
    restore.push(() => setPlatformRuntime(prev))
  }
  const hookBuffer = (buf: BufferModel) => {
    const prev = buf.onSplice
    buf.link = link
    state.baseBufSeq.set(buf.id, buf.seq)
    buf.onSplice = (s, o) => {
      // snapshot:false ⇒ undo/redo/append: no new undo node was recorded, so
      // shipping it would break the 1:1 sent↔undo-node invariant the rebase
      // rewind relies on. Those edits route via Cmd or A→S rebase instead.
      if (o.snapshot === false) return
      const op: Splice = { ...s, seq: state.nextSeq++ }
      const list = state.pending.get(buf.id) ?? []
      list.push(op)
      setPending(editor, state, buf.id, list)
      const sent = state.sent.get(buf.id) ?? []
      sent.push({ ...op, bufSeq: buf.seq })
      if (sent.length > MAX_SENT) state.baseBufSeq.set(buf.id, sent.shift()!.bufSeq)
      state.sent.set(buf.id, sent)
      link.send(op)
    }
    restore.push(() => { buf.onSplice = prev; buf.link = undefined; buf.locals.delete(PENDING_KEY) })
  }
  for (const b of editor.buffers.values()) hookBuffer(b)

  link.on(op => void onShadowOp(editor, link, state, op, hookBuffer))

  const detach = () => {
    for (const r of restore) r()
    editor.locals.delete(SHADOW_KEY)
  }
  opts?.onDispose?.(detach)
  return detach
}

/** Re-send every unacked pending splice. For DST drain; real transports will
 *  drive this off a timeout. A's seq buffer makes the resends idempotent. */
export function resendPending(editor: Editor): number {
  const state = shadowState(editor)
  if (!state) return 0
  let n = 0
  for (const list of state.pending.values()) {
    for (const op of list) { state.link.send(op); n++ }
  }
  return n
}

/** S-side receive: ack/rebase/lsp handled here; splice/point/buffer/layout via the chokepoint. */
async function onShadowOp(editor: Editor, link: ShadowLink, state: ShadowState, op: ShadowOp, hookBuffer: (b: BufferModel) => void): Promise<void> {
  switch (op.kind) {
    case "ack": {
      for (const [id, list] of state.pending) {
        setPending(editor, state, id, list.filter(p => p.seq > op.upTo))
      }
      // `sent` is NOT pruned here — see MAX_SENT for why ack-time pruning is
      // unsafe under reorder and how memory is bounded instead.
      break
    }
    case "rebase": {
      const buf = editor.buffers.get(op.bufferId)
      if (!buf) break
      const sentList = state.sent.get(op.bufferId) ?? []
      const wasPending = new Set((state.pending.get(op.bufferId) ?? []).map(p => p.seq))
      // Map wire baseSeq → buf.seq. `sent` survives ack, so an ack reordered
      // ahead of this rebase can't under-count the rewind.
      let targetBufSeq = state.baseBufSeq.get(op.bufferId) ?? 0
      for (const s of sentList) if (s.seq <= op.baseSeq) targetBufSeq = s.bufSeq
      const toRewind = sentList.filter(s => s.seq > op.baseSeq)
      withoutEmit(buf, () => {
        // 1. Rewind optimistic state to baseSeq via the undo tree.
        buf.rewindTo(targetBufSeq)
        // 2. Apply A's ops with gravity point-adjust (not replaceRange's forced
        //    jump) so S.point tracks baseline when toRewind is empty.
        //    snapshot:false — they become the new base, not a user-undoable step.
        for (const a of op.ops) buf.splice(a.from, a.to, a.text, { snapshot: false })
        // 3. Transform surviving sent past A's ops, re-apply, advancing A's
        //    ops past each replayed op so the next transform is in-frame.
        let exts = op.ops.slice()
        const survived: SentSplice[] = []
        for (const p of toRewind) {
          const t = transformPast(p, exts, true)
          if (t) { buf.replaceRange(t.from, t.to, t.text); survived.push({ ...t, bufSeq: buf.seq }) }
          exts = advancePast(exts, p)
        }
        // 4. sent/pending now relative to A's tip; baseBufSeq advances to baseSeq.
        state.baseBufSeq.set(op.bufferId, targetBufSeq)
        state.sent.set(op.bufferId, survived)
        setPending(editor, state, op.bufferId, survived.filter(s => wasPending.has(s.seq)))
      })
      // Stale-sync path lands here too: the diff arrived as a rebase, S is now
      // at A's text. Record it in the CAS so the next BufferRef is a hit.
      buf.locals.set("shadow-cached-sha", state.cas.write(buf.text))
      buf.locals.delete("shadow-sync")
      break
    }
    case "lsp":
      editor.buffers.get(op.bufferId)?.locals.set("shadow-lsp", op)
      break
    case "buffer": {
      applyRemoteOp(editor, link, op)
      const buf = editor.buffers.get(op.id)
      if (buf) hookBuffer(buf)
      if (buf && state.wantCurrent === buf.id) editor.switchToBuffer(buf.id)
      break
    }
    case "buffer-ref": {
      // Hit: S's CAS has op.sha → render now, send Have{sha}, zero text bytes.
      // Stale: S has *a* version (buffer.locals["shadow-cached-sha"]) but not op.sha
      //   → keep rendering it with [⊘ syncing], send Have{cachedSha}; A diffs and
      //   replies rebase{ops}. Same convergence machinery as an external splice.
      // Miss: nothing → empty placeholder + Want; A streams Chunks.
      const hit = state.cas.lookupAsync ? await state.cas.lookupAsync(op.sha) : state.cas.lookup(op.sha)
      let buf = editor.buffers.get(op.id)
      if (!buf) {
        buf = editor.addBuffer(new BufferModel({ id: op.id, name: op.name, path: op.path, text: hit ?? "", mode: op.mode }))
        hookBuffer(buf)
      } else if (hit !== undefined && buf.text !== hit) {
        withoutEmit(buf, () => buf!.replaceRange(0, buf!.text.length, hit))
      }
      buf.link = link
      if (state.wantCurrent === buf.id) editor.switchToBuffer(buf.id)
      if (hit !== undefined) {
        buf.locals.set("shadow-cached-sha", op.sha)
        buf.locals.delete("shadow-sync")
        link.send({ kind: "have", id: op.id, sha: op.sha })
        break
      }
      buf.locals.set("shadow-sync", "syncing")
      const cachedSha = buf.locals.get("shadow-cached-sha") as string | undefined
      link.send(cachedSha ? { kind: "have", id: op.id, sha: cachedSha } : { kind: "want", id: op.id })
      break
    }
    case "manifest-tree":
    case "manifest-delta":
      state.runtime?.onOp(op)
      break
    case "manifest-req":
      // S→A only; never honored on S.
      break
    case "chunk": {
      // Runtime-issued Wants (id = path) are reassembled there; buffer-sync
      // chunks (id = bufferId) fall through to the partial map below.
      if (state.runtime?.onOp(op)) break
      const buf = editor.buffers.get(op.id)
      if (!buf) break
      let p = state.partial.get(op.id)
      if (!p) state.partial.set(op.id, p = { chunks: new Map() })
      p.chunks.set(op.offset, op.data)
      if (op.eof) p.eofAt = op.offset
      if (p.eofAt === undefined) break
      // Assemble only once 0..eofAt is contiguous; otherwise wait for the gap to fill.
      let assembled = "", at = 0
      for (;;) {
        const slice = p.chunks.get(at)
        if (slice === undefined) break
        assembled += slice
        if (at === p.eofAt) {
          state.partial.delete(op.id)
          withoutEmit(buf, () => buf.replaceRange(0, buf.text.length, assembled))
          buf.locals.set("shadow-cached-sha", state.cas.write(assembled))
          buf.locals.delete("shadow-sync")
          break
        }
        at += slice.length
      }
      break
    }
    case "splice":
    case "point":
    case "layout":
      applyRemoteOp(editor, link, op)
      break
    case "command":
      // A→S `switch-to-buffer`: land S on the buffer A opened from argv (so a
      // fresh shadow doesn't sit on *scratch* while A is showing the file).
      // All other Cmds remain S→A only — A is the side that runs them.
      if (op.name === "switch-to-buffer" && typeof op.args[0] === "string") {
        state.wantCurrent = op.args[0]
        if (editor.buffers.has(op.args[0])) editor.switchToBuffer(op.args[0])
      }
      break
    case "have":
    case "want":
      // S→A only; never honored on S.
      break
  }
  void editor.changed("shadow-remote")
}

// ── Authority side (A) ──────────────────────────────────────────────────────

const S_IFDIR = 0o040000

/** Subscribe `watcher` and ship a `ManifestDelta` per fs change. Replaces
 *  `AuthorityFs.watch`: events that fire while a rehash is in flight are queued
 *  (not dropped), and each event re-reads only the changed path then bubbles
 *  `dirHash` up its ancestor chain — O(depth), not O(tree). */
function watchAuthorityFs(link: ShadowLink, fs: FsLike, root: string, watcher: FsWatcher): () => void {
  const byPath = new Map<string, ManifestEntry>()
  /** dir → immediate-child paths, for O(children) dirHash recompute. */
  const kids = new Map<string, Set<string>>()
  const queue: string[] = []
  const queued = new Set<string>()
  let busy = true // gate events until the seed walk has populated byPath

  const addKid = (p: string) => {
    const d = dirname(p)
    if (d === p) return
    let s = kids.get(d); if (!s) kids.set(d, s = new Set())
    s.add(p)
  }
  const childEntries = (dir: string): ManifestEntry[] =>
    [...(kids.get(dir) ?? [])].map(p => byPath.get(p)).filter((e): e is ManifestEntry => !!e)

  const rehash = async (path: string): Promise<ManifestDelta["changes"]> => {
    const changes: ManifestDelta["changes"] = []
    const prev = byPath.get(path)
    let st: { mode: number; size: number; mtime: number } | undefined
    try { st = await fs.stat(path) } catch { /* ENOENT → delete */ }
    if (!st) {
      if (!prev) return changes
      const drop = (p: string) => {
        const e = byPath.get(p); if (!e) return
        changes.push({ path: p, old: e.sha })
        byPath.delete(p)
        for (const c of [...(kids.get(p) ?? [])]) drop(c)
        kids.delete(p)
      }
      drop(path)
      kids.get(dirname(path))?.delete(path)
    } else {
      const isDir = (st.mode & S_IFDIR) !== 0
      const sha = isDir ? dirHash(childEntries(path)) : sha256(await fs.readFile(path))
      const e: ManifestEntry = { path, sha, mode: st.mode, size: st.size, mtime: st.mtime }
      byPath.set(path, e); addKid(path)
      if (prev?.sha === sha && prev.mtime === e.mtime && prev.size === e.size && prev.mode === e.mode) return changes
      changes.push({ path, old: prev?.sha, new: e })
    }
    // Bubble dirHash up; an unchanged ancestor sha means everything above is unchanged too.
    for (let d = dirname(path); ; d = dirname(d)) {
      const de = byPath.get(d); if (!de) break
      const sha = dirHash(childEntries(d))
      if (de.sha === sha) break
      const ne: ManifestEntry = { ...de, sha }
      byPath.set(d, ne)
      changes.push({ path: d, old: de.sha, new: ne })
      if (d === dirname(d)) break
    }
    return changes
  }

  const pump = async () => {
    while (queue.length) {
      const path = queue.shift()!; queued.delete(path)
      const changes = await rehash(path)
      if (changes.length) link.send({ kind: "manifest-delta", changes })
    }
    busy = false
  }

  void buildManifest(fs, root).then(m => {
    for (const e of m) { byPath.set(e.path, e); addKid(e.path) }
    void pump()
  })

  return watcher(({ path }) => {
    if (queued.has(path)) return
    queued.add(path); queue.push(path)
    if (!busy) { busy = true; void pump() }
  })
}

export function attachAuthority(editor: Editor, link: ShadowLink, opts?: AttachOpts): () => void {
  const state: AuthorityState = {
    link, cas: opts?.cas ?? new FileCas(), recvSeq: 0, held: new Map(), lastSeq: new Map(), external: new Map(),
    flushMs: opts?.flushMs ?? 50, flushEveryN: opts?.flushEveryN ?? 32, acksSinceFlush: 0,
  }
  editor.locals.set(AUTHORITY_KEY, state)

  const restore: Array<() => void> = []
  if (opts?.fs) {
    state.fs = createAuthorityFs(link, opts.fs, opts.fsRoot)
    if (opts.watcher) restore.push(watchAuthorityFs(link, opts.fs, opts.fsRoot ?? "/", opts.watcher))
  }
  const hookAuthorityBuffer = (buf: BufferModel) => {
    const prev = buf.onSplice
    // Any splice that fires while onSplice is installed is, by construction, *not*
    // from S (applyRemoteOp suppresses the hook), so it's an external edit.
    buf.onSplice = s => {
      const list = state.external.get(buf.id) ?? []
      list.push(s)
      state.external.set(buf.id, list)
      scheduleFlush(editor, state)
    }
    restore.push(() => { buf.onSplice = prev })
  }
  for (const buf of editor.buffers.values()) hookAuthorityBuffer(buf)
  const prevOnAdd = editor.onAddBuffer
  editor.onAddBuffer = b => { hookAuthorityBuffer(b); prevOnAdd?.(b) }
  restore.push(() => { editor.onAddBuffer = prevOnAdd })

  link.on(op => void onAuthorityOp(editor, link, state, op))

  const detach = () => {
    if (state.flushTimer !== undefined) { clearTimeout(state.flushTimer); state.flushTimer = undefined }
    for (const r of restore) r()
    editor.locals.delete(AUTHORITY_KEY)
  }
  opts?.onDispose?.(detach)
  return detach
}

/** A-side: announce `bufferId` to S as a `BufferRef` (sha, no text). S decides
 *  hit/stale/miss against its CAS and replies Have or Want. Call this on
 *  buffer-add (find-file, get-buffer-create) for buffers S should mirror.
 *  Skips scratch/messages/minibuffer — S's own Editor() already has those. */
export function announceBuffer(editor: Editor, bufferId: string): void {
  const state = authorityState(editor)
  const buf = editor.buffers.get(bufferId)
  if (!state || !buf) return
  if (buf.name === "*scratch*" || buf.name === "*messages*" || buf.kind === "minibuffer") return
  const sha = state.cas.write(buf.text)
  state.link.send({ kind: "buffer-ref", id: buf.id, name: buf.name, path: buf.path, sha, mode: buf.mode })
  // Tell S which buffer A is looking at so the shadow lands there on connect.
  if (bufferId === editor.currentBufferId) {
    state.link.send({ kind: "command", name: "switch-to-buffer", args: [bufferId], seq: 0 })
  }
}

/** Arm/reset the debounce timer that calls `flushExternal` once S has been
 *  quiet for `flushMs`. No-op when the timer is disabled (≤0) — DST runs
 *  synchronously and calls flushExternal from drain() instead. */
function scheduleFlush(editor: Editor, state: AuthorityState): void {
  if (state.flushMs <= 0) return
  if (state.flushTimer !== undefined) clearTimeout(state.flushTimer)
  state.flushTimer = setTimeout(() => { state.flushTimer = undefined; flushExternal(editor) }, state.flushMs)
}

/** Ship any buffered externals to S as a rebase at the current lastSeq, then clear.
 *  Driven by the debounce timer / Nth-ack fallback on real links, or explicitly
 *  from the DST drain. Safe to call when external is empty (no-op). */
export function flushExternal(editor: Editor): number {
  const state = authorityState(editor)
  if (!state) return 0
  if (state.flushTimer !== undefined) { clearTimeout(state.flushTimer); state.flushTimer = undefined }
  state.acksSinceFlush = 0
  let n = 0
  for (const [bufferId, ext] of state.external) {
    if (!ext.length) continue
    state.link.send({ kind: "rebase", bufferId, baseSeq: state.lastSeq.get(bufferId) ?? 0, ops: ext.slice() })
    state.external.set(bufferId, [])
    n++
  }
  return n
}

/** A-side receive: S may send splice/point/command/have/want. Anything else is wrong-direction. */
async function onAuthorityOp(editor: Editor, link: ShadowLink, state: AuthorityState, op: ShadowOp): Promise<void> {
  switch (op.kind) {
    case "have": {
      const buf = editor.buffers.get(op.id)
      if (!buf) return
      const cur = sha256(buf.text)
      if (op.sha === cur) {
        // S already has the exact text. Ack at current hwm so S clears any sync state.
        link.send({ kind: "ack", upTo: state.recvSeq })
        return
      }
      const cached = state.cas.lookupAsync ? await state.cas.lookupAsync(op.sha) : state.cas.lookup(op.sha)
      if (cached !== undefined) {
        // S has a stale version A can reconstruct → ship the diff as a rebase.
        // baseSeq=lastSeq so S applies on top with no rewind (same as flushExternal).
        const ops = diffText(cached, buf.text, op.id)
        link.send({ kind: "rebase", bufferId: op.id, baseSeq: state.lastSeq.get(op.id) ?? 0, ops })
        return
      }
      // A can't reconstruct S's version → fall through to full chunk stream.
      for (const c of chunkText(op.id, buf.text)) link.send(c)
      return
    }
    case "want": {
      const buf = editor.buffers.get(op.id)
      if (buf) { for (const c of chunkText(op.id, buf.text)) link.send(c); return }
      state.fs?.onOp(op)
      return
    }
    case "manifest-req":
      state.fs?.onOp(op)
      return
    case "splice":
    case "point":
    case "command": {
      // Reliability: dedup + in-order. seq is monotone per S, global across kinds.
      if (op.seq <= state.recvSeq) {
        // Already applied (or held-then-applied). Re-ack so a resending S can
        // clear pending even if the original ack was dropped.
        link.send({ kind: "ack", upTo: state.recvSeq })
        return
      }
      if (op.seq !== state.recvSeq + 1) {
        state.held.set(op.seq, op)
        return
      }
      applyAuthorityOp(editor, link, state, op)
      // Drain any contiguous run that was waiting on this one.
      let next: SeqOp | undefined
      while ((next = state.held.get(state.recvSeq + 1))) {
        state.held.delete(state.recvSeq + 1)
        applyAuthorityOp(editor, link, state, next)
      }
      return
    }
    default:
      // ack/rebase/buffer/layout/lsp are A→S only.
      return
  }
}

/** Apply one in-order S op to A. Splices are transformed past any buffered
 *  externals (S's frame → A's frame); externals are then advanced past the op
 *  so the next S op transforms against the right frame. Rebase is *not* sent
 *  here — it ships via flushExternal once S is quiescent. */
function applyAuthorityOp(editor: Editor, link: ShadowLink, state: AuthorityState, op: SeqOp): void {
  state.recvSeq = op.seq
  if (op.kind === "splice") {
    const ext = state.external.get(op.bufferId) ?? []
    const t = transformPast(op, ext, true)
    if (t) {
      applyRemoteOp(editor, link, t)
      state.external.set(op.bufferId, advancePast(ext, op))
    } else {
      // S's op overlapped an external A already applied — S's frame is stale.
      // advancePast would silently drop the overlapping ext (it's been applied
      // to A's buffer but S would never learn of it ⇒ permanent divergence).
      // Ship ext as a rebase now so S rewinds, applies it, and discards the
      // conflicting op via the same null-on-overlap rule. ext is then cleared.
      link.send({ kind: "rebase", bufferId: op.bufferId, baseSeq: state.lastSeq.get(op.bufferId) ?? 0, ops: ext.slice() })
      state.external.set(op.bufferId, [])
    }
    state.lastSeq.set(op.bufferId, op.seq)
  } else if (op.kind === "point") {
    applyRemoteOp(editor, link, op)
    state.lastSeq.set(op.bufferId, op.seq)
  } else {
    applyRemoteOp(editor, link, op)
  }
  link.send({ kind: "ack", upTo: op.seq })
  // Deferred-rebase trigger for real links: prefer to ship ext once S goes
  // quiet (debounce), but cap how long a hot S can defer it (Nth-ack).
  state.acksSinceFlush++
  for (const ext of state.external.values()) {
    if (!ext.length) continue
    if (state.acksSinceFlush >= state.flushEveryN) flushExternal(editor)
    else scheduleFlush(editor, state)
    break
  }
}
