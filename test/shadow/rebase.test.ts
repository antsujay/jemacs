import { describe, expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { rebaseBuffer } from "../../src/shadow/rebase"
import type { Splice } from "../../src/shadow/ops"

/** Apply a splice to `buf` and return the wire op tagged with the buffer's resulting seq. */
function edit(buf: BufferModel, from: number, to: number, text: string): Splice {
  buf.splice(from, to, text)
  return { kind: "splice", bufferId: buf.id, from, to, text, seq: buf.seq }
}

describe("shadow/rebase", () => {
  test("partition + heal: non-overlapping concurrent edits converge", () => {
    const A = new BufferModel({ id: "buf", name: "a", text: "hello world" })
    const S = new BufferModel({ id: "buf", name: "s", text: "hello world" })
    const baseSeq = S.seq // last sync point

    // — partition —
    const pending = [
      edit(S, 5, 5, "!!"),  // "hello!! world"
      edit(S, 13, 13, "?"), // "hello!! world?"
    ]
    const authorityOps = [edit(A, 0, 0, ">> ")] // ">> hello world"
    expect(S.text).toBe("hello!! world?")
    expect(A.text).toBe(">> hello world")

    // — heal: S receives rebase{baseSeq, authorityOps} —
    const newPending = rebaseBuffer(S, baseSeq, authorityOps, pending)

    // — A receives the transformed pending and applies them —
    for (const p of newPending) if (p) A.splice(p.from, p.to, p.text)

    expect(newPending.every(p => p !== null)).toBe(true)
    expect(S.text).toBe(A.text)
    expect(S.text).toBe(">> hello!! world?")
  })

  test("overlapping concurrent edit is invalidated; shadow snaps to authority", () => {
    const A = new BufferModel({ id: "buf", name: "a", text: "the quick brown fox" })
    const S = new BufferModel({ id: "buf", name: "s", text: "the quick brown fox" })
    const baseSeq = S.seq

    const pending = [edit(S, 4, 9, "slow")]       // S: "the slow brown fox"
    const authorityOps = [edit(A, 4, 15, "red")]  // A: "the red fox"

    const newPending = rebaseBuffer(S, baseSeq, authorityOps, pending)

    expect(newPending).toEqual([null])
    expect(S.text).toBe(A.text)
    expect(S.text).toBe("the red fox")
  })

  test("pending shifts compose across multiple authority ops", () => {
    const A = new BufferModel({ id: "buf", name: "a", text: "abcdef" })
    const S = new BufferModel({ id: "buf", name: "s", text: "abcdef" })
    const baseSeq = S.seq

    const pending = [edit(S, 6, 6, "Z")] // "abcdefZ"
    const authorityOps = [
      edit(A, 0, 0, "1"),  // "1abcdef"
      edit(A, 4, 5, ""),   // "1abcef"  (delete 'd')
    ]

    const newPending = rebaseBuffer(S, baseSeq, authorityOps, pending)
    for (const p of newPending) if (p) A.splice(p.from, p.to, p.text)

    expect(S.text).toBe(A.text)
    expect(S.text).toBe("1abcefZ")
    // shifted +1 then -1 → net 0, but landed at the right place via composition
    expect(newPending[0]!.from).toBe(6)
  })

  test("rewindTo walks the undo tree back to baseSeq", () => {
    const S = new BufferModel({ id: "buf", name: "s", text: "base" })
    const baseSeq = S.seq
    expect(baseSeq).toBe(0)

    const pending = [edit(S, 4, 4, "1"), edit(S, 5, 5, "2"), edit(S, 6, 6, "3")]
    expect(S.text).toBe("base123")
    expect(S.seq).toBe(3)

    const newPending = rebaseBuffer(S, baseSeq, [], pending)

    // No authority ops ⇒ rewind + reapply is identity on text; pending get fresh seqs.
    expect(S.text).toBe("base123")
    expect(newPending.map(p => p?.seq)).toEqual([4, 5, 6])
    expect(S.seq).toBe(6)
  })

  test("survivors carry fresh seqs and rebaseBuffer suppresses onSplice", () => {
    const S = new BufferModel({ id: "buf", name: "s", text: "xy" })
    const baseSeq = S.seq
    const pending = [edit(S, 2, 2, "z")]

    let fired = 0
    S.onSplice = () => { fired++ }

    const newPending = rebaseBuffer(S, baseSeq, [{ kind: "splice", bufferId: "buf", from: 0, to: 0, text: ".", seq: 1 }], pending)

    expect(fired).toBe(0)
    expect(S.onSplice).toBeDefined() // restored
    expect(newPending[0]!.seq).toBeGreaterThan(pending[0]!.seq)
    expect(S.text).toBe(".xyz")
  })

  test("convergence under interleaved partition (randomized, seeded)", () => {
    // Minimal DST shape: baseline oracle, partition with concurrent ops, heal, drain.
    const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000) }
    for (const seed of [1, 7, 42, 9001]) {
      const r = rng(seed)
      const base = "abcdefghijklmnop"
      const A = new BufferModel({ id: "b", name: "a", text: base })
      const S = new BufferModel({ id: "b", name: "s", text: base })
      const baseSeq = S.seq

      // Partition: each side does 3 disjoint single-char inserts in its own half
      // (S left half, A right half) so no overlap ⇒ every pending survives.
      const pending: Splice[] = []
      const authorityOps: Splice[] = []
      for (let i = 0; i < 3; i++) {
        const sPos = Math.floor(r() * 5)
        pending.push(edit(S, sPos, sPos, "S"))
        const aPos = 11 + Math.floor(r() * 5)
        authorityOps.push(edit(A, aPos + i, aPos + i, "A")) // +i: prior A inserts shifted right half
      }

      const newPending = rebaseBuffer(S, baseSeq, authorityOps, pending)
      for (const p of newPending) if (p) A.splice(p.from, p.to, p.text)

      expect(newPending.every(p => p !== null)).toBe(true)
      expect(S.text, `seed=${seed}`).toBe(A.text)
    }
  })
})
