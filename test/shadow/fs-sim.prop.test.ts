import { describe, test } from "bun:test"
import { FsSimulator, type Adversary, type FsSimulatorOpts } from "./fs-sim"

// FS-replica DST: 5 link adversaries × 5 seeds × 3 watcher miss rates × 200 steps.

const ADVERSARIES: Array<[string, Partial<Adversary>]> = [
  ["clean",   {}],
  ["reorder", { reorderP: 0.5, maxDelay: 3 }],
  ["drop",    { dropP: 0.2, maxDelay: 1 }],
  ["dup",     { dupP: 0.3, maxDelay: 1 }],
  ["chaos",   { reorderP: 0.3, dropP: 0.1, dupP: 0.1, maxDelay: 5 }],
]

const SEEDS = [1, 7, 42, 1337, 90210]
const WATCHER_MISS_P = [0, 0.1, 0.3]
const STEPS = 200

function tryRun(seed: number, opts: FsSimulatorOpts, steps: number): string | null {
  const sim = new FsSimulator(seed, opts)
  sim.run(steps)
  try { sim.checkInvariant(); return null } catch (e) { return (e as Error).message }
}

for (const [name, adversary] of ADVERSARIES) {
  for (const watcherMissP of WATCHER_MISS_P) {
    describe(`fs-sim ${name} missP=${watcherMissP}`, () => {
      for (const seed of SEEDS) {
        test(`seed ${seed} × ${STEPS} steps converges`, () => {
          const opts: FsSimulatorOpts = { adversary, watcherMissP }
          const err = tryRun(seed, opts, STEPS)
          if (err) {
            // Shrink to minimal failing step count for the repro line.
            let lo = 1, hi = STEPS
            while (lo < hi) {
              const mid = (lo + hi) >> 1
              if (tryRun(seed, opts, mid) === null) lo = mid + 1; else hi = mid
            }
            throw new Error(`[seed=${seed} ${name} missP=${watcherMissP} step=${lo}] ${err}`)
          }
        })
      }
    })
  }
}
