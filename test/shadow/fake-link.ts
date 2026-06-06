import type { ShadowLink, ShadowRole } from "../../src/shadow/link"
import type { ShadowOp } from "../../src/shadow/ops"
import { SeededRng } from "./rng"

/** Minimal PRNG surface FakeLink needs — lets sim.ts pass its LCG, tests pass mulberry32. */
export interface Rng {
  next(): number
  int(n: number): number
}

/** Per-tick perturbation probabilities, all in [0, 1]. `maxDelay` is the
 *  upper bound (in ticks) on the random arrival delay assigned at send time. */
export interface Adversary {
  reorderP: number
  dropP: number
  dupP: number
  maxDelay: number
}

const NO_ADVERSARY: Adversary = { reorderP: 0, dropP: 0, dupP: 0, maxDelay: 0 }

interface Inflight {
  op: ShadowOp
  readyAt: number
}

/**
 * In-memory `ShadowLink` for the DST simulator (DESIGN.md §DST simulator).
 *
 * `send()` enqueues onto the peer's inflight (or this link's, if unpaired).
 * Nothing is delivered until `tick()` / `drain()`. `tick(n)` makes n delivery
 * attempts: each advances the logical clock by 1, picks one eligible op
 * (readyAt ≤ clock), and subjects it to the adversary — drop, dup, or reorder.
 * `partition()` makes tick/drain into no-ops until `heal()`. `drain()` flushes
 * everything still in flight without perturbation, for end-of-run convergence.
 */
export class FakeLink implements ShadowLink {
  readonly peerId: string
  readonly role: ShadowRole
  readonly trust: "full" | "propose"

  partitioned = false
  readonly inflight: Inflight[] = []

  private clock = 0
  private handler: ((op: ShadowOp) => void) | undefined
  private readonly rng: Rng
  private readonly adversary: Adversary
  private closed = false
  private peer?: FakeLink

  constructor(opts: {
    peerId: string
    role: ShadowRole
    rng: Rng
    trust?: "full" | "propose"
    adversary?: Partial<Adversary>
  }) {
    this.peerId = opts.peerId
    this.role = opts.role
    this.trust = opts.trust ?? "full"
    this.rng = opts.rng
    this.adversary = { ...NO_ADVERSARY, ...opts.adversary }
  }

  /** Build a wired S↔A pair. Both links share `rng` so a seed determines the
   *  full perturbation schedule across both directions. */
  static pair(opts: { rng?: Rng; adversary?: Partial<Adversary> } = {}): { sLink: FakeLink; aLink: FakeLink } {
    const rng = opts.rng ?? new SeededRng(0)
    const sLink = new FakeLink({ peerId: "A", role: "shadow", rng, adversary: opts.adversary })
    const aLink = new FakeLink({ peerId: "S", role: "authority", rng, adversary: opts.adversary })
    sLink.peer = aLink
    aLink.peer = sLink
    return { sLink, aLink }
  }

  /** Enqueue an op for delivery to *this* side's handler. Called by the peer's send(). */
  private enqueue(op: ShadowOp): void {
    if (this.closed) return
    const delay = this.adversary.maxDelay > 0 ? this.rng.int(this.adversary.maxDelay + 1) : 0
    this.inflight.push({ op, readyAt: this.clock + delay })
  }

  send(op: ShadowOp): void {
    ;(this.peer ?? this).enqueue(op)
  }

  on(handler: (op: ShadowOp) => void): void {
    this.handler = handler
  }

  close(): void {
    this.closed = true
    this.inflight.length = 0
    this.handler = undefined
  }

  partition(): void {
    this.partitioned = true
  }

  heal(): void {
    this.partitioned = false
  }

  /** Make `n` delivery attempts. Returns the number of handler invocations
   *  (a dup counts as one; a drop counts as zero). */
  tick(n: number): number {
    let delivered = 0
    for (let i = 0; i < n; i++) {
      this.clock++
      if (this.partitioned || this.closed || !this.handler) continue

      // Eligible = arrived by now. Indices into `inflight`, oldest-first.
      const eligible: number[] = []
      for (let j = 0; j < this.inflight.length; j++) {
        if (this.inflight[j]!.readyAt <= this.clock) eligible.push(j)
      }
      if (eligible.length === 0) continue

      // reorder: pick a random eligible op instead of FIFO head.
      const pickIdx =
        this.rng.next() < this.adversary.reorderP
          ? eligible[this.rng.int(eligible.length)]!
          : eligible[0]!
      const { op } = this.inflight[pickIdx]!

      // drop: consume from queue, never deliver.
      if (this.rng.next() < this.adversary.dropP) {
        this.inflight.splice(pickIdx, 1)
        continue
      }

      // dup: deliver but leave in queue so it can fire again.
      const dup = this.rng.next() < this.adversary.dupP
      if (!dup) this.inflight.splice(pickIdx, 1)
      this.handler(op)
      delivered++
    }
    return delivered
  }

  /** Deliver everything still in flight, FIFO, with no adversary effects.
   *  Respects partition — heal first if you want guaranteed convergence. */
  drain(): number {
    if (this.partitioned || this.closed || !this.handler) return 0
    let delivered = 0
    while (this.inflight.length > 0) {
      const { op } = this.inflight.shift()!
      this.handler(op)
      delivered++
    }
    return delivered
  }

  /** Alias for `drain()` — sim.ts calls this name on each side of a pair. */
  drainSide(): number {
    return this.drain()
  }
}
