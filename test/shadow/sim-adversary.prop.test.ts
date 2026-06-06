import { describe, expect, test } from "bun:test"
import { Simulator, type SimulatorOpts } from "./sim"

// sim.prop.test.ts passes with a perfect link. These crank reorder/drop/dup/delay
// — they're the real test of reconciliation. All test.failing until shadow.ts grows
// retransmit (drop), receiver-side seq buffering (reorder), and high-water-mark dedup.

export type Adversary = { reorderP: number; dropP: number; dupP: number; maxDelay: number }

const ADVERSARIES: Array<[string, Adversary]> = [
  ["reorder", { reorderP: 0.5, dropP: 0,    dupP: 0,   maxDelay: 3 }],
  ["drop",    { reorderP: 0,   dropP: 0.2,  dupP: 0,   maxDelay: 1 }],
  ["dup",     { reorderP: 0,   dropP: 0,    dupP: 0.3, maxDelay: 1 }],
  ["delay",   { reorderP: 0,   dropP: 0,    dupP: 0,   maxDelay: 8 }],
  ["chaos",   { reorderP: 0.3, dropP: 0.1,  dupP: 0.1, maxDelay: 5 }],
]

function tryRun(seed: number, opts: SimulatorOpts, steps: number): string | null {
  const sim = new Simulator(seed, opts)
  sim.run(steps)
  try { sim.checkInvariant(); return null } catch (e) { return (e as Error).message }
}

for (const [name, adv] of ADVERSARIES) {
  describe(`sim adversary: ${name}`, () => {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      test.failing(`seed ${seed} × 300 steps converges`, () => {
        const opts: SimulatorOpts = { adversary: adv, withExternalSplice: true }
        const err = tryRun(seed, opts, 300)
        if (err) {
          // Shrink: bisect to minimal failing step count for the repro line.
          let lo = 1, hi = 300
          while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (tryRun(seed, opts, mid) == null) lo = mid + 1; else hi = mid
          }
          throw new Error(`[seed=${seed} ${name} step=${lo}] ${err}`)
        }
        expect(err).toBeNull()
      })
    }
  })
}
