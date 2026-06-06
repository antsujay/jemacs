import { expect, test, describe } from "bun:test"
import { transformSplice, opKey, type Splice } from "../../src/shadow/ops"

const sp = (from: number, to: number, text = "", seq = 1): Splice =>
  ({ kind: "splice", bufferId: "b", from, to, text, seq })

describe("transformSplice", () => {
  test("no-overlap left: pending entirely before applied → unchanged", () => {
    expect(transformSplice(sp(0, 3, "x"), sp(5, 8, "yyy"))).toEqual(sp(0, 3, "x"))
  })

  test("no-overlap right, net insert: shifts by +delta", () => {
    // applied [2,4)→"abcde": delta = 5 - 2 = +3
    expect(transformSplice(sp(10, 13, "x"), sp(2, 4, "abcde"))).toEqual(sp(13, 16, "x"))
  })

  test("no-overlap right, net delete: shifts by -delta", () => {
    // applied [2,6)→"a": delta = 1 - 4 = -3
    expect(transformSplice(sp(10, 13, "x"), sp(2, 6, "a"))).toEqual(sp(7, 10, "x"))
  })

  test("no-overlap right, length-preserving replace: identity", () => {
    const p = sp(10, 13, "x")
    expect(transformSplice(p, sp(2, 5, "abc"))).toBe(p)
  })

  test("contained: pending inside applied → null", () => {
    expect(transformSplice(sp(3, 5, "x"), sp(2, 8, "y"))).toBeNull()
  })

  test("containing: pending wraps applied → null", () => {
    expect(transformSplice(sp(2, 8, "x"), sp(3, 5, "y"))).toBeNull()
  })

  test("exact overlap → null", () => {
    expect(transformSplice(sp(3, 7, "x"), sp(3, 7, "y"))).toBeNull()
  })

  test("partial overlap left edge → null", () => {
    expect(transformSplice(sp(2, 5, "x"), sp(4, 8, "y"))).toBeNull()
  })

  test("partial overlap right edge → null", () => {
    expect(transformSplice(sp(4, 8, "x"), sp(2, 5, "y"))).toBeNull()
  })

  test("adjacent left: pending.to === applied.from → unchanged", () => {
    const p = sp(0, 3, "x")
    expect(transformSplice(p, sp(3, 6, "yy"))).toBe(p)
  })

  test("adjacent right: pending.from === applied.to → shifted", () => {
    // applied [2,5)→"" : delta = -3
    expect(transformSplice(sp(5, 8, "x"), sp(2, 5, ""))).toEqual(sp(2, 5, "x"))
  })

  test("pure-insert pending at applied.from boundary stays put (to ≤ aFrom tie-break)", () => {
    const p = sp(3, 3, "ins")
    expect(transformSplice(p, sp(3, 3, "AAA"))).toBe(p)
  })

  test("pure-insert pending after pure-insert applied shifts", () => {
    expect(transformSplice(sp(7, 7, "ins"), sp(3, 3, "AAA"))).toEqual(sp(10, 10, "ins"))
  })

  test("applied pure insert inside pending range invalidates", () => {
    expect(transformSplice(sp(2, 8, "x"), sp(5, 5, "AAA"))).toBeNull()
  })

  test("preserves seq, bufferId, text on shift", () => {
    const out = transformSplice(
      { kind: "splice", bufferId: "buf-1", from: 10, to: 12, text: "hi", seq: 42 },
      sp(0, 0, "XYZ"),
    )
    expect(out).toEqual({ kind: "splice", bufferId: "buf-1", from: 13, to: 15, text: "hi", seq: 42 })
  })
})

describe("opKey", () => {
  test("seq-bearing ops key on kind:seq", () => {
    expect(opKey(sp(0, 1, "", 7))).toBe("splice:7")
    expect(opKey({ kind: "point", bufferId: "b", point: 3, seq: 7 })).toBe("point:7")
    expect(opKey({ kind: "command", name: "save-buffer", args: [], seq: 7 })).toBe("command:7")
  })

  test("ack and rebase key on their seq fields", () => {
    expect(opKey({ kind: "ack", upTo: 12 })).toBe("ack:12")
    expect(opKey({ kind: "rebase", bufferId: "b", baseSeq: 4, ops: [] })).toBe("rebase:b:4")
  })

  test("duplicate splices with same seq collide; different seqs don't", () => {
    expect(opKey(sp(0, 1, "a", 5))).toBe(opKey(sp(9, 9, "zzz", 5)))
    expect(opKey(sp(0, 1, "a", 5))).not.toBe(opKey(sp(0, 1, "a", 6)))
  })
})
