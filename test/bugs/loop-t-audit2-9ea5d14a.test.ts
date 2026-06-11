import { expect, test } from "bun:test"
import { chunkText } from "../../src/shadow/ops"

// chunkText must never split a surrogate pair across chunks — a lone surrogate
// is replaced with U+FFFD by any UTF-8 transport, so reassembly would corrupt.
test("chunkText keeps surrogate pairs intact across chunk boundaries", () => {
  // 5 ascii + 1 astral (2 code units) → length 7; size=6 lands the boundary
  // between the high and low surrogate.
  const text = "abcde" + "\u{1F600}"
  const chunks = chunkText("b", text, 6)
  for (const c of chunks) expect(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(c.data)).toBe(false)
  expect(chunks.map(c => c.data).join("")).toBe(text)

  // Round-trip through a UTF-8 link (TextEncoder/Decoder) at size=1 over a run
  // of astral code points — every boundary would tear without the guard.
  const emoji = "\u{1F600}\u{1F601}\u{1F602}\u{1F603}"
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const reassembled = chunkText("b", emoji, 1).map(c => dec.decode(enc.encode(c.data))).join("")
  expect(reassembled).toBe(emoji)
})
