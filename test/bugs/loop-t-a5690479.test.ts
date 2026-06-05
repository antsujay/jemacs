import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { orgDisplayFilter, ORG_FOLDED_LOCAL, type FoldRange } from "../../plugins/org"

// t-a5690479: orgDisplayFilter rebuilt the collapsed text + bufStart/dispStart
// tables from scratch on every render, and map() did a linear scan over
// bufStart. build-display-model calls map() twice per font-lock span, so a
// 2000-line buffer with 5000 spans was ~20M iterations per keystroke. Fix:
// memoize the filter in buffer.locals keyed on (text, fold-ranges) identity,
// and binary-search bufStart inside map().

function orgBuf(text: string, folded: FoldRange[]): BufferModel {
  const buf = new BufferModel({ name: "t.org", text, mode: "org-mode" })
  buf.locals.set(ORG_FOLDED_LOCAL, folded)
  return buf
}

test("orgDisplayFilter: memoized while text+folds unchanged, invalidated on either", () => {
  const buf = orgBuf("* A\nbody\n* B\n", [[1, 1]])
  const a = orgDisplayFilter(buf)!
  const b = orgDisplayFilter(buf)!
  expect(b).toBe(a) // same frame state → same object, no rebuild

  buf.locals.set(ORG_FOLDED_LOCAL, [[1, 1]]) // setFolded writes a fresh array
  expect(orgDisplayFilter(buf)).not.toBe(a)

  const c = orgDisplayFilter(buf)!
  buf.insert("x") // _splice → new text identity
  expect(orgDisplayFilter(buf)).not.toBe(c)
})

test("orgDisplayFilter: map() is sub-linear per call on long buffers", () => {
  const L = 4000
  const lines = ["* Top"]
  for (let i = 1; i < L; i++) lines.push(`body line ${i}`)
  const buf = orgBuf(lines.join("\n"), [[1, 1]])
  const filt = orgDisplayFilter(buf)!
  const len = buf.text.length
  expect(filt.map(len)).toBe(filt.text.length) // EOF maps to EOF
  // build-display-model remaps every span end; worst case for the linear
  // `while bufStart[i+1] <= n` scan is an offset near EOF → walks all L lines.
  const N = 20000
  const t0 = performance.now()
  let sink = 0
  for (let k = 0; k < N; k++) sink += filt.map(len - (k & 7))
  const ms = performance.now() - t0
  expect(sink).toBeGreaterThan(0)
  // Linear: N×L ≈ 8e7 iterations ≈ 120–250ms here. Binary search:
  // N×log2(L) ≈ 2.4e5 ≈ <2ms. 40ms cleanly separates the two.
  expect(ms).toBeLessThan(40)
})

// Correctness guard: memoized/binary-searched map must agree with the old
// linear path on every offset, including hidden ranges and EOF.
test("orgDisplayFilter: map() output unchanged across all offsets", () => {
  const text = "* A\na1\na2\n* B\nb1\n* C\n"
  const buf = orgBuf(text, [[1, 2], [4, 4]])
  const { text: dText, map } = orgDisplayFilter(buf)!
  expect(dText).toBe("* A...\n* B...\n* C\n")
  const got = Array.from({ length: text.length + 1 }, (_, n) => map(n))
  // Reference: brute-force linear remap, mirroring the pre-fix algorithm.
  const lines = text.split("\n")
  const bufStart = [0]; for (const l of lines) bufStart.push(bufStart.at(-1)! + l.length + 1)
  const hidden = (i: number) => [[1, 2], [4, 4]].some(([a, b]) => i >= a && i <= b)
  const dispStart: number[] = []; let d = 0, last = 0
  for (let i = 0; i < lines.length; i++) {
    if (hidden(i)) { dispStart.push(last); continue }
    if (d > 0) d += 1
    dispStart.push(d); d += lines[i]!.length; last = d
    if (i + 1 < lines.length && hidden(i + 1)) d += 3
  }
  const want = Array.from({ length: text.length + 1 }, (_, n) => {
    let i = 0; while (i + 1 < lines.length && bufStart[i + 1]! <= n) i++
    return hidden(i) ? dispStart[i]! : dispStart[i]! + Math.min(n - bufStart[i]!, lines[i]!.length)
  })
  expect(got).toEqual(want)
})
