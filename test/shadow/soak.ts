#!/usr/bin/env bun
/**
 * DST soak — `bun run test/shadow/soak.ts`
 *
 * Link-level: cranks the test.skip("soak") in sim.prop.test.ts — 200 seeds ×
 * 2000 steps × 5 link adversaries, full action set (externals on).
 *
 * FS-level: cranks fs-sim.prop.test.ts — same seed/step budget × 5 link
 * adversaries × 3 watcher miss rates, with bisected min-step on failure.
 *
 * Prints a per-cell progress line and a per-failure repro block.
 * Exit 0 ⇔ zero failures across both layers.
 */

import { Simulator, type Adversary, type SimulatorOpts } from "./sim"
import { FsSimulator, type FsSimulatorOpts } from "./fs-sim"

// Same five as sim-adversary.prop.test.ts.
const ADVERSARIES: Array<[string, Adversary]> = [
  ["reorder", { reorderP: 0.5, dropP: 0,    dupP: 0,   maxDelay: 3 }],
  ["drop",    { reorderP: 0,   dropP: 0.2,  dupP: 0,   maxDelay: 1 }],
  ["dup",     { reorderP: 0,   dropP: 0,    dupP: 0.3, maxDelay: 1 }],
  ["delay",   { reorderP: 0,   dropP: 0,    dupP: 0,   maxDelay: 8 }],
  ["chaos",   { reorderP: 0.3, dropP: 0.1,  dupP: 0.1, maxDelay: 5 }],
]

interface Failure {
  phase: string
  adversary: string
  seed: number
  step: number
  message: string
  /** fs-sim only: watcher miss rate. */
  missP?: number
  /** fs-sim only: bisected minimal failing step count. */
  minStep?: number
}

interface Phase {
  name: string
  seeds: number
  steps: number
  opts: (adv: Adversary) => SimulatorOpts
}

function tryRun(seed: number, opts: SimulatorOpts, steps: number): { ok: true } | { ok: false; step: number; message: string } {
  const sim = new Simulator(seed, opts)
  try {
    sim.run(steps)
    sim.checkInvariant()
    return { ok: true }
  } catch (e) {
    // sim.fail() embeds seed/step/buffer/trace-tail in the message; capture stepN
    // separately so the summary table doesn't have to parse it back out.
    return { ok: false, step: sim.stepN, message: (e as Error).message }
  }
}

function runPhase(phase: Phase, failures: Failure[]): void {
  const total = ADVERSARIES.length * phase.seeds
  console.log(`\n── ${phase.name}: ${phase.seeds} seeds × ${phase.steps} steps × ${ADVERSARIES.length} adversaries (${total} runs) ──`)
  const t0 = performance.now()
  let done = 0
  for (const [advName, adv] of ADVERSARIES) {
    let advFail = 0
    const a0 = performance.now()
    for (let seed = 1; seed <= phase.seeds; seed++) {
      const r = tryRun(seed, phase.opts(adv), phase.steps)
      done++
      if (!r.ok) {
        advFail++
        failures.push({ phase: phase.name, adversary: advName, seed, step: r.step, message: r.message })
        console.error(`\n  ✗ [${phase.name}] adversary=${advName} seed=${seed} step=${r.step}`)
        // First line of sim.fail() is the load-bearing summary; rest is repro+trace.
        for (const line of r.message.split("\n")) console.error(`    ${line}`)
      }
    }
    const dt = ((performance.now() - a0) / 1000).toFixed(1)
    const status = advFail === 0 ? "ok" : `${advFail} FAIL`
    console.log(`  ${advName.padEnd(8)} ${done}/${total}  ${status.padEnd(8)} ${dt}s`)
  }
  console.log(`  ⇒ ${(((performance.now() - t0) / 1000)).toFixed(1)}s total`)
}

// ── Phases ──────────────────────────────────────────────────────────────────

const SEEDS = Number(process.env.SOAK_SEEDS ?? 200)
const STEPS = Number(process.env.SOAK_STEPS ?? 2000)

const phases: Phase[] = [
  {
    name: "main",
    seeds: SEEDS,
    steps: STEPS,
    opts: adv => ({ adversary: adv, withExternalSplice: true }),
  },
]

const failures: Failure[] = []
const T0 = performance.now()

for (const p of phases) runPhase(p, failures)

// Conditional extensions: only if main is clean (per task), so a real
// convergence bug doesn't get buried under follow-on noise.
if (failures.length === 0) {
  // 2-buffer: second buffer is inert (sim.ts only drives bufferIds[0]) but it
  // still exercises per-buffer state maps (pending/external/lastSeq) for
  // cross-contamination, and checkInvariant asserts buf-2 stays at initialText.
  runPhase({
    name: "2-buffer",
    seeds: SEEDS,
    steps: STEPS,
    opts: adv => ({ adversary: adv, withExternalSplice: true, bufferIds: ["buf-1", "buf-2"] }),
  }, failures)

  // Larger "alphabet": KEYS is module-const in sim.ts so we can't widen the key
  // set from here, but a long mixed initialText pushes splice offsets, undo
  // depth, and transformPast shift arithmetic well past the empty-start case.
  const wide = Array.from({ length: 256 }, (_, i) => String.fromCharCode(33 + (i % 94))).join("")
  runPhase({
    name: "wide-initial",
    seeds: SEEDS,
    steps: STEPS,
    opts: adv => ({ adversary: adv, withExternalSplice: true, initialText: wide }),
  }, failures)
} else {
  console.log("\n(skipping 2-buffer / wide-initial extensions: main phase has failures)")
}

// ── FS-replica soak ─────────────────────────────────────────────────────────
// One layer up from the link sim: FsSimulator drives manifest/CAS/watcher
// reconciliation. Runs unconditionally — independent failure surface from the
// link phases above. Same five adversaries (plus a clean baseline) crossed with
// watcher miss rates; on failure, bisect to the minimal repro step count.

const FS_ADVERSARIES: Array<[string, Partial<Adversary>]> = [
  ["clean",   {}],
  ["reorder", { reorderP: 0.5, maxDelay: 3 }],
  ["drop",    { dropP: 0.2, maxDelay: 1 }],
  ["dup",     { dupP: 0.3, maxDelay: 1 }],
  ["chaos",   { reorderP: 0.3, dropP: 0.1, dupP: 0.1, maxDelay: 5 }],
]
const WATCHER_MISS_P = [0, 0.1, 0.3]

function tryRunFs(seed: number, opts: FsSimulatorOpts, steps: number): { ok: true } | { ok: false; step: number; message: string } {
  const sim = new FsSimulator(seed, opts)
  try {
    sim.run(steps)
    sim.checkInvariant()
    return { ok: true }
  } catch (e) {
    return { ok: false, step: sim.stepN, message: (e as Error).message }
  }
}

function runFsSoak(failures: Failure[]): void {
  const total = FS_ADVERSARIES.length * WATCHER_MISS_P.length * SEEDS
  console.log(`\n── fs-sim: ${SEEDS} seeds × ${STEPS} steps × ${FS_ADVERSARIES.length} adversaries × ${WATCHER_MISS_P.length} missP (${total} runs) ──`)
  const t0 = performance.now()
  let done = 0
  for (const [advName, adversary] of FS_ADVERSARIES) {
    for (const missP of WATCHER_MISS_P) {
      let cellFail = 0
      const c0 = performance.now()
      for (let seed = 1; seed <= SEEDS; seed++) {
        const opts: FsSimulatorOpts = { adversary, watcherMissP: missP }
        const r = tryRunFs(seed, opts, STEPS)
        done++
        if (!r.ok) {
          // Bisect to the minimal step count that still fails — same shrink as
          // fs-sim.prop.test.ts, so the repro line is copy-pasteable.
          let lo = 1, hi = STEPS
          while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (tryRunFs(seed, opts, mid).ok) lo = mid + 1; else hi = mid
          }
          cellFail++
          failures.push({ phase: "fs-sim", adversary: advName, seed, step: r.step, missP, minStep: lo, message: r.message })
          console.error(`\n  ✗ [fs-sim] adversary=${advName} missP=${missP} seed=${seed} step=${r.step} (min repro step=${lo})`)
          for (const line of r.message.split("\n")) console.error(`    ${line}`)
        }
      }
      const dt = ((performance.now() - c0) / 1000).toFixed(1)
      const status = cellFail === 0 ? "ok" : `${cellFail} FAIL`
      console.log(`  ${advName.padEnd(8)} missP=${String(missP).padEnd(4)} ${done}/${total}  ${status.padEnd(8)} ${dt}s`)
    }
  }
  console.log(`  ⇒ ${(((performance.now() - t0) / 1000)).toFixed(1)}s total`)
}

runFsSoak(failures)

// ── Summary ─────────────────────────────────────────────────────────────────

const wall = ((performance.now() - T0) / 1000).toFixed(1)
if (failures.length === 0) {
  console.log(`\n✓ soak clean — 0 failures in ${wall}s`)
  process.exit(0)
}

console.error(`\n✗ soak: ${failures.length} failure(s) in ${wall}s\n`)
console.error("  phase        adversary  missP  seed   step   minStep")
console.error("  ───────────  ─────────  ─────  ─────  ─────  ───────")
for (const f of failures) {
  const missP = f.missP === undefined ? "-" : String(f.missP)
  const minStep = f.minStep === undefined ? "-" : String(f.minStep)
  console.error(`  ${f.phase.padEnd(11)}  ${f.adversary.padEnd(9)}  ${missP.padEnd(5)}  ${String(f.seed).padEnd(5)}  ${String(f.step).padEnd(5)}  ${minStep}`)
}
process.exit(1)
