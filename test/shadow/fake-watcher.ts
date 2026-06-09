import type { Rng } from "./fake-link"
import type { FakeFs, FsChange } from "./fake-fs"

/**
 * Simulated watchman subscription (DESIGN.md §Scaling: "change discovery needs
 * watchman"). Mirrors FakeLink semantics one layer down: every FakeFs mutation
 * lands in `pending` with a random `readyAt`; `tick(n)` advances the logical
 * clock and delivers eligible changes subject to `missP` (the watcher silently
 * dropping an event — the failure mode the heartbeat exists to repair).
 *
 * `drain()` flushes everything still pending with no adversary, for end-of-run
 * convergence checks. Unlike FakeLink there's no reorder/dup knob — watchman's
 * cursor protocol is in-order and at-most-once, so miss + delay are the
 * adversaries that matter.
 */

export interface WatcherOpts {
  /** Upper bound on random delivery delay, in ticks. */
  delayMax: number
  /** Probability a change is dropped at delivery time (never reaches the handler). */
  missP: number
  rng: Rng
}

interface Pending { change: FsChange; readyAt: number }

export interface FakeWatcher {
  /** Changes accepted from the FS but not yet delivered (or dropped). */
  readonly pending: FsChange[]
  /** Advance `n` ticks; returns delivered count. */
  tick(n: number): number
  /** Deliver everything still pending, no adversary. */
  drain(): number
  /** Detach from the FS. */
  close(): void
}

export function subscribe(
  fs: FakeFs,
  opts: WatcherOpts,
  handler: (c: FsChange) => void,
): FakeWatcher {
  const queue: Pending[] = []
  let clock = 0
  let closed = false

  const off = fs.onChange(c => {
    if (closed) return
    const delay = opts.delayMax > 0 ? opts.rng.int(opts.delayMax + 1) : 0
    queue.push({ change: c, readyAt: clock + delay })
  })

  const deliverAt = (i: number): void => {
    const { change } = queue.splice(i, 1)[0]!
    handler(change)
  }

  return {
    get pending() { return queue.map(p => p.change) },

    tick(n: number): number {
      let delivered = 0
      for (let step = 0; step < n; step++) {
        clock++
        if (closed) continue
        // FIFO among eligible — watchman is in-order, so first-ready-first-out.
        const i = queue.findIndex(p => p.readyAt <= clock)
        if (i < 0) continue
        if (opts.rng.next() < opts.missP) {
          queue.splice(i, 1)
          continue
        }
        deliverAt(i)
        delivered++
      }
      return delivered
    },

    drain(): number {
      if (closed) return 0
      let delivered = 0
      while (queue.length) { deliverAt(0); delivered++ }
      return delivered
    },

    close(): void {
      closed = true
      queue.length = 0
      off()
    },
  }
}
