import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { attachAuthority, attachShadow, authorityState, shadowState } from "../../src/shadow/shadow"
import type { ShadowLink, ShadowRole } from "../../src/shadow/link"
import type { ShadowOp } from "../../src/shadow/ops"

// ── SeededRng ───────────────────────────────────────────────────────────────
// LCG (Numerical Recipes constants) — same generator as test/property/buffer.prop.test.ts,
// wrapped so the simulator can hand out ints/picks without threading a closure.

export class SeededRng {
  private s: number
  constructor(seed: number) { this.s = seed >>> 0 }
  next(): number { return (this.s = (this.s * 1664525 + 1013904223) >>> 0) / 0x100000000 }
  /** Uniform int in [0, n). n=0 ⇒ 0. */
  int(n: number): number { return n > 0 ? Math.floor(this.next() * n) : 0 }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]! }
}

// ── FakeLink ────────────────────────────────────────────────────────────────
// One half of an in-process A↔S pair. `send` enqueues onto the *peer's* inflight;
// `tick(n)` dequeues from *this* side's inflight and dispatches to the registered
// handler. `partitioned` gates *delivery* (tick), not send — i.e. partition is a
// delay adversary, not a drop. shadow.ts has no resend-on-heal yet, so a true drop
// adversary would just prove "no resend ⇒ no convergence", which isn't interesting.
// reorder/drop/dup hooks are TODO once the protocol grows resend.

export class FakeLink implements ShadowLink {
  readonly peerId: string
  readonly role: ShadowRole
  readonly trust = "full" as const
  /** Ops queued for delivery *to* this side. */
  inflight: ShadowOp[] = []
  partitioned = false
  private handler: (op: ShadowOp) => void = () => {}
  private peer!: FakeLink

  private constructor(peerId: string, role: ShadowRole) {
    this.peerId = peerId
    this.role = role
  }

  /** Build a wired S↔A pair. */
  static pair(): { sLink: FakeLink; aLink: FakeLink } {
    const sLink = new FakeLink("A", "shadow")
    const aLink = new FakeLink("S", "authority")
    sLink.peer = aLink
    aLink.peer = sLink
    return { sLink, aLink }
  }

  send(op: ShadowOp): void { this.peer.inflight.push(op) }
  on(handler: (op: ShadowOp) => void): void { this.handler = handler }
  close(): void { this.handler = () => {} }

  /** Deliver up to `n` queued ops to this side's handler. No-op while partitioned. */
  tick(n: number): number {
    if (this.partitioned) return 0
    let i = 0
    while (i < n && this.inflight.length > 0) {
      this.handler(this.inflight.shift()!)
      i++
    }
    return i
  }

  drainSide(): void {
    while (!this.partitioned && this.inflight.length > 0) this.tick(this.inflight.length)
  }
}

// ── Simulator ───────────────────────────────────────────────────────────────

/** Small alphabet + nav keys. Dispatched via `applyKey` (direct BufferModel calls)
 *  rather than `Editor.handleKey` so the sim stays kernel-only — no config/lisp
 *  install ⇒ deterministic, fast, no FS, no `crypto.randomUUID` beyond the two
 *  default Editor buffers (which the invariant skips). */
const KEYS = ["a", "b", "c", "d", "e", "\n", "<left>", "<right>", "<bs>", "<del>", "<home>", "<end>"] as const
export type Key = typeof KEYS[number]

const EXT_CHARS = "VWXYZ"

export type Action =
  | { k: "key"; key: Key }
  | { k: "ext"; from: number; to: number; text: string }
  | { k: "partition" }
  | { k: "heal" }
  | { k: "tick"; n: number }

function applyKey(buf: BufferModel, key: Key): void {
  switch (key) {
    case "<left>":  buf.move(-1); break
    case "<right>": buf.move(1); break
    case "<bs>":    buf.deleteBackward(); break
    case "<del>":   buf.deleteForward(); break
    case "<home>":  buf.point = 0; break
    case "<end>":   buf.point = buf.text.length; break
    default:        buf.insert(key)
  }
}

export type SimulatorOpts = {
  initialText?: string
  bufferIds?: string[]
  /** Include externalSplice(A) in the random action mix. Off by default: the
   *  current `onShadowOp` rebase mis-transforms when ≥2 pending splices straddle
   *  an external (it transforms each pending past the raw authority op, but
   *  doesn't advance the authority op past already-replayed pendings — so the
   *  second pending lands at the wrong offset). Flip this on to hunt that class
   *  of bug; the soak test does. */
  withExternalSplice?: boolean
}

export class Simulator {
  readonly A: Editor
  readonly S: Editor
  readonly baseline: Editor
  readonly sLink: FakeLink
  readonly aLink: FakeLink
  readonly rng: SeededRng
  readonly bufferIds: readonly string[]
  readonly trace: Action[] = []
  readonly withExternalSplice: boolean
  stepN = 0

  constructor(readonly seed: number, opts: SimulatorOpts = {}) {
    this.rng = new SeededRng(seed)
    this.withExternalSplice = opts.withExternalSplice ?? false
    this.A = new Editor()
    this.S = new Editor()
    this.baseline = new Editor()
    this.bufferIds = opts.bufferIds ?? ["buf-1"]
    const text = opts.initialText ?? ""
    for (const id of this.bufferIds) {
      this.A.addBuffer(new BufferModel({ id, name: id, text }))
      this.S.addBuffer(new BufferModel({ id, name: id, text }))
      this.baseline.addBuffer(new BufferModel({ id, name: id, text }))
    }
    const { sLink, aLink } = FakeLink.pair()
    this.sLink = sLink
    this.aLink = aLink
    attachAuthority(this.A, aLink)
    attachShadow(this.S, sLink)
  }

  buf(e: Editor, id = this.bufferIds[0]!): BufferModel { return e.buffers.get(id)! }

  /** Nothing in flight, no unacked pending on S, no unflushed external on A. */
  private quiescent(): boolean {
    if (this.sLink.partitioned || this.sLink.inflight.length || this.aLink.inflight.length) return false
    const ss = shadowState(this.S)
    const as = authorityState(this.A)
    for (const id of this.bufferIds) {
      if ((ss?.pending.get(id)?.length ?? 0) > 0) return false
      if ((as?.external.get(id)?.length ?? 0) > 0) return false
    }
    return true
  }

  /** Heal, pump both directions to fixpoint, then force-flush any externals A is
   *  sitting on (otherwise they only ship piggybacked on S's next splice). */
  drain(): void {
    this.sLink.partitioned = false
    this.aLink.partitioned = false
    const pump = () => {
      while (this.aLink.inflight.length || this.sLink.inflight.length) {
        this.aLink.drainSide()
        this.sLink.drainSide()
      }
    }
    pump()
    const as = authorityState(this.A)!
    for (const id of this.bufferIds) {
      const ext = as.external.get(id)
      if (ext?.length) {
        as.link.send({ kind: "rebase", bufferId: id, baseSeq: as.lastSeq.get(id) ?? 0, ops: ext.slice() })
        as.external.set(id, [])
      }
    }
    pump()
  }

  step(): Action {
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

  private genAction(): Action {
    const r = this.rng
    const roll = r.int(20)
    if (roll < 10) return { k: "key", key: r.pick(KEYS) }
    if (roll < 15) return { k: "tick", n: r.int(5) }
    if (roll < 18 || !this.withExternalSplice) {
      return this.sLink.partitioned ? { k: "heal" } : { k: "partition" }
    }
    // externalSplice — only at a quiescent point so (from,to) means the same
    // thing on A and baseline.
    if (!this.quiescent()) this.drain()
    const len = this.buf(this.A).text.length
    const from = r.int(len + 1)
    const to = Math.min(len, from + r.int(3))
    const text = Array.from({ length: 1 + r.int(2) }, () => EXT_CHARS[r.int(EXT_CHARS.length)]).join("")
    return { k: "ext", from, to, text }
  }

  apply(a: Action): void {
    switch (a.k) {
      case "key":
        applyKey(this.buf(this.S), a.key)
        applyKey(this.buf(this.baseline), a.key)
        break
      case "ext":
        // `splice`, not `replaceRange`: we want gravity point-adjust on baseline so
        // it tracks S's post-rebase point, not a forced jump to end-of-insert.
        this.buf(this.A).splice(a.from, a.to, a.text)
        this.buf(this.baseline).splice(a.from, a.to, a.text)
        break
      case "partition":
        this.sLink.partitioned = true
        this.aLink.partitioned = true
        break
      case "heal":
        this.sLink.partitioned = false
        this.aLink.partitioned = false
        break
      case "tick":
        this.aLink.tick(a.n)
        this.sLink.tick(a.n)
        break
    }
  }

  /** A.text ≡ S.text ≡ baseline.text per buffer; S.point ≡ baseline.point.
   *  A.point is *not* checked: attachShadow doesn't emit Point ops yet, so A's
   *  cursor lags S by design — separate workstream, not a convergence failure. */
  checkInvariant(): void {
    for (const id of this.bufferIds) {
      const a = this.buf(this.A, id)
      const s = this.buf(this.S, id)
      const b = this.buf(this.baseline, id)
      if (a.text !== s.text || s.text !== b.text) {
        throw this.fail(id, `text diverged\n  A=${JSON.stringify(a.text)}\n  S=${JSON.stringify(s.text)}\n  B=${JSON.stringify(b.text)}`)
      }
      if (s.point !== b.point) {
        throw this.fail(id, `point diverged S=${s.point} baseline=${b.point} (text=${JSON.stringify(s.text)})`)
      }
    }
    const ss = shadowState(this.S)
    for (const id of this.bufferIds) {
      const pend = ss?.pending.get(id) ?? []
      if (pend.length) throw this.fail(id, `pending not drained: ${pend.length} ops`)
    }
  }

  private fail(bufferId: string, msg: string): Error {
    const start = Math.max(0, this.trace.length - 30)
    const tail = this.trace.slice(start).map((a, i) => `  [${start + i}] ${JSON.stringify(a)}`).join("\n")
    return new Error(
      `seed=${this.seed} step=${this.stepN} buffer=${bufferId}: ${msg}\n` +
      `repro: new Simulator(${this.seed}${this.withExternalSplice ? ", {withExternalSplice:true}" : ""}).run(${this.stepN})\n` +
      `last ${this.trace.length - start} actions:\n${tail}`,
    )
  }
}
