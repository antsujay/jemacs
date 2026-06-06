import { describe, expect, test } from "bun:test"
import type { ShadowOp, Splice } from "../../src/shadow/ops"
import { FakeLink } from "./fake-link"
import { SeededRng } from "./rng"

const sp = (seq: number): Splice => ({ kind: "splice", bufferId: "b", from: 0, to: 0, text: "", seq })

const collect = (link: FakeLink): ShadowOp[] => {
  const got: ShadowOp[] = []
  link.on((op) => got.push(op))
  return got
}

describe("FakeLink", () => {
  test("partition blocks delivery; ops queue in inflight", () => {
    const link = new FakeLink({ peerId: "S", role: "shadow", rng: new SeededRng(1) })
    const got = collect(link)
    link.partition()
    link.send(sp(1))
    link.send(sp(2))
    link.send(sp(3))
    expect(link.tick(10)).toBe(0)
    expect(got).toEqual([])
    expect(link.inflight.length).toBe(3)
    expect(link.partitioned).toBe(true)
  })

  test("heal + drain delivers everything queued during partition, in order", () => {
    const link = new FakeLink({ peerId: "S", role: "shadow", rng: new SeededRng(1) })
    const got = collect(link)
    link.partition()
    for (let i = 1; i <= 5; i++) link.send(sp(i))
    expect(link.drain()).toBe(0) // still partitioned
    link.heal()
    expect(link.drain()).toBe(5)
    expect(got.map((o) => (o as Splice).seq)).toEqual([1, 2, 3, 4, 5])
    expect(link.inflight.length).toBe(0)
  })

  test("dupP=1 delivers the same op twice", () => {
    // dropP=0 so the dup roll is the next rng draw after reorder; dupP=1 forces it.
    const link = new FakeLink({
      peerId: "S",
      role: "shadow",
      rng: new SeededRng(7),
      adversary: { dupP: 1 },
    })
    const got = collect(link)
    link.send(sp(42))
    expect(link.tick(2)).toBe(2)
    expect(got.map((o) => (o as Splice).seq)).toEqual([42, 42])
    // Still in the queue because dup never consumes.
    expect(link.inflight.length).toBe(1)
  })

  test("reorderP=1 delivers out of send sequence", () => {
    // Seed chosen so the first random pick from {0,1,2,3} is not index 0.
    const link = new FakeLink({
      peerId: "S",
      role: "shadow",
      rng: new SeededRng(3),
      adversary: { reorderP: 1 },
    })
    const got = collect(link)
    for (let i = 1; i <= 4; i++) link.send(sp(i))
    link.tick(4)
    const seqs = got.map((o) => (o as Splice).seq)
    expect(seqs.length).toBe(4)
    expect([...seqs].sort()).toEqual([1, 2, 3, 4]) // same multiset
    expect(seqs).not.toEqual([1, 2, 3, 4]) // but not FIFO
  })

  test("no adversary, no partition: tick is FIFO", () => {
    const link = new FakeLink({ peerId: "S", role: "shadow", rng: new SeededRng(1) })
    const got = collect(link)
    for (let i = 1; i <= 3; i++) link.send(sp(i))
    expect(link.tick(3)).toBe(3)
    expect(got.map((o) => (o as Splice).seq)).toEqual([1, 2, 3])
  })

  test("dropP=1 consumes without delivering", () => {
    const link = new FakeLink({
      peerId: "S",
      role: "shadow",
      rng: new SeededRng(1),
      adversary: { dropP: 1 },
    })
    const got = collect(link)
    link.send(sp(1))
    link.send(sp(2))
    expect(link.tick(5)).toBe(0)
    expect(got).toEqual([])
    expect(link.inflight.length).toBe(0)
  })
})

describe("SeededRng", () => {
  test("same seed → same sequence", () => {
    const a = new SeededRng(12345)
    const b = new SeededRng(12345)
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next())
  })

  test("different seeds → different sequences", () => {
    const a = new SeededRng(1)
    const b = new SeededRng(2)
    expect(a.next()).not.toBe(b.next())
  })

  test("next() ∈ [0,1)", () => {
    const r = new SeededRng(99)
    for (let i = 0; i < 1000; i++) {
      const x = r.next()
      expect(x >= 0 && x < 1).toBe(true)
    }
  })

  test("int(n) ∈ [0,n)", () => {
    const r = new SeededRng(42)
    for (let i = 0; i < 1000; i++) {
      const x = r.int(7)
      expect(Number.isInteger(x) && x >= 0 && x < 7).toBe(true)
    }
  })

  test("choice picks from array", () => {
    const r = new SeededRng(5)
    const arr = ["a", "b", "c"]
    for (let i = 0; i < 100; i++) expect(arr).toContain(r.choice(arr))
  })
})
