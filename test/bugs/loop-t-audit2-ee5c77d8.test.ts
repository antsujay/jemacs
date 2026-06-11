import { expect, test } from "bun:test"
import { ChunkAssembler } from "../../src/shadow/link"
import { chunkText } from "../../src/shadow/ops"

// t-audit2-ee5c77d8: A→S Chunk stream has no reliability layer. shadow.ts /
// remote-runtime.ts reassemble {offset→slice} until 0..eofAt is contiguous —
// but on a gap they just wait, forever, with the buffer stuck in [⊘ syncing].
// Coalescer.resend() (t-audit2-55748cf1) is the retransmit primitive; what was
// missing is the assembler that *detects the stall* and fires it. ChunkAssembler
// is that: feed() returns the text once complete, and on eof-with-gap it calls
// `resend` so A re-streams (chunk application is idempotent on offset).

/** Fake A: each Want re-streams `text` as chunks; `lossy` drops one chunk per
 *  stream by index, so dropping `eof` and dropping a middle chunk are both testable. */
function fakeAuthority(text: string, size: number) {
  const wants: number[] = []
  let lossy: number[] = []
  return {
    wants,
    drop(...indices: number[]) { lossy = indices },
    stream(asm: ChunkAssembler): string | undefined {
      wants.push(wants.length)
      const chunks = chunkText("b", text, size)
      const drop = lossy.shift()
      let out: string | undefined
      for (let i = 0; i < chunks.length; i++) {
        if (i === drop) continue
        out = asm.feed(chunks[i]!) ?? out
      }
      return out
    },
  }
}

test("ChunkAssembler: eof-with-gap fires resend; re-stream completes", () => {
  const text = "abcdefghijklmnopqrstuvwxyz0123456789"
  const A = fakeAuthority(text, 4) // 9 chunks
  let got: string | undefined
  const asm = new ChunkAssembler(() => { got = A.stream(asm) ?? got })

  A.drop(2) // drop the chunk at offset 8
  got = A.stream(asm) ?? got

  // One initial Want + one retransmit; second stream has no drop → completes.
  expect(A.wants.length).toBe(2)
  expect(got).toBe(text)
  expect(asm.nudge()).toBe(false) // latched
})

test("ChunkAssembler: dropped eof recovers via nudge()", () => {
  const text = "abcdefghijkl"
  const A = fakeAuthority(text, 4) // 3 chunks; index 2 is eof
  let got: string | undefined
  const asm = new ChunkAssembler(() => { got = A.stream(asm) ?? got })

  A.drop(2) // drop eof — feed never sees a gap, just never completes
  expect(A.stream(asm)).toBeUndefined()
  expect(A.wants.length).toBe(1) // no auto-resend without eof

  // Heartbeat / DST-drain nudge → re-issue Want; this stream delivers eof.
  expect(asm.nudge()).toBe(true)
  expect(A.wants.length).toBe(2)
  expect(got).toBe(text)
  // After completion nudge is a no-op.
  expect(asm.nudge()).toBe(false)
})

test("ChunkAssembler: idempotent on dup; bounded retransmits under sustained loss", () => {
  const text = "0123456789abcdef"
  const A = fakeAuthority(text, 4)
  let got: string | undefined
  const asm = new ChunkAssembler(() => { got = A.stream(asm) ?? got }, 3)

  // Dup before drop: feeding offset 0 twice mustn't break the walk.
  asm.feed({ kind: "chunk", id: "b", offset: 0, data: "0123" })

  // Every stream drops index 1 → never completes; auto-resend must cap, not storm.
  A.drop(1, 1, 1, 1, 1, 1, 1, 1)
  expect(A.stream(asm)).toBeUndefined()
  expect(A.wants.length).toBeGreaterThan(1)        // retransmit fired at least once
  expect(A.wants.length).toBeLessThanOrEqual(1 + 3) // …but capped, not a storm

  // nudge() can still force one more round once the link heals.
  A.drop() // healed
  const before = A.wants.length
  expect(asm.nudge()).toBe(true)
  expect(A.wants.length).toBe(before + 1)
  expect(got).toBe(text)
  expect(asm.nudge()).toBe(false) // latched once done
})
