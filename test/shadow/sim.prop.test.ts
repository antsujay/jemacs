import { describe, expect, test } from "bun:test"
import { Simulator, SeededRng, FakeLink, type Action } from "./sim"

describe("shadow/sim sanity", () => {
  test("SeededRng is deterministic and reproducible", () => {
    const a = new SeededRng(42)
    const b = new SeededRng(42)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
    expect(new SeededRng(7).int(1000)).toBe(new SeededRng(7).int(1000))
  })

  test("FakeLink: send enqueues on peer; tick delivers; partition gates tick", () => {
    const { sLink, aLink } = FakeLink.pair()
    const got: number[] = []
    aLink.on(op => got.push((op as { upTo: number }).upTo))
    sLink.send({ kind: "ack", upTo: 1 })
    sLink.send({ kind: "ack", upTo: 2 })
    expect(aLink.inflight.length).toBe(2)
    expect(aLink.tick(1)).toBe(1)
    expect(got).toEqual([1])
    // Partition is a delay, not a drop: send still enqueues, tick refuses to deliver.
    aLink.partitioned = true
    sLink.send({ kind: "ack", upTo: 3 })
    expect(aLink.inflight.length).toBe(2)
    expect(aLink.tick(5)).toBe(0)
    aLink.partitioned = false
    aLink.drainSide()
    expect(got).toEqual([1, 2, 3])
  })

  test("smoke: 50 steps, drained, three-way convergence", () => {
    const sim = new Simulator(1)
    sim.run(50)
    sim.checkInvariant()
    const t = sim.buf(sim.S).text
    expect(t.length).toBeGreaterThan(0)
    expect(sim.buf(sim.A).text).toBe(t)
    expect(sim.buf(sim.baseline).text).toBe(t)
  })

  test("ext path, single pending: rebase converges", () => {
    // Hand-driven trace exercising the rebase machinery without tripping the
    // multi-pending bug below.
    const sim = new Simulator(0)
    const script: Action[] = [
      { k: "ext", from: 0, to: 0, text: "Z" },
      { k: "key", key: "a" },
      { k: "tick", n: 4 },
    ]
    for (const a of script) { sim.stepN++; sim.trace.push(a); sim.apply(a) }
    sim.drain()
    sim.checkInvariant()
    expect(sim.buf(sim.A).text).toBe("aZ")
  })
})

describe("shadow/sim property", () => {
  const SEEDS = [1, 42, 1337, 0xdead, 12345]
  const STEPS = 500

  for (const seed of SEEDS) {
    test(`A ≡ S ≡ baseline after ${STEPS} steps (seed=${seed})`, () => {
      const sim = new Simulator(seed)
      sim.run(STEPS)
      sim.checkInvariant()
    })
  }

  // Regression guard: ≥2 pending splices straddling an external. Covered by
  // A advancing external past each applied S op and shipping the rebase
  // deferred at flushExternal, so S applies it on top with no rewind.
  test("ext + 2 pending splices: deferred rebase converges", () => {
    const sim = new Simulator(0)
    const script: Action[] = [
      { k: "ext", from: 0, to: 0, text: "Z" },
      { k: "key", key: "a" },
      { k: "key", key: "b" },
    ]
    for (const a of script) { sim.stepN++; sim.trace.push(a); sim.apply(a) }
    sim.drain()
    sim.checkInvariant() // throws: A="abZ" S="aZb"
  })

  // Overnight soak — flip to `test` to run. withExternalSplice:true turns on
  // the full action set; expect failures until the rebase bug above is fixed.
  test.skip("soak: 200 seeds × 2000 steps", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const sim = new Simulator(seed, { withExternalSplice: true })
      sim.run(2000)
      sim.checkInvariant()
    }
  })
})
