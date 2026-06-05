import { expect, test } from "bun:test"
import { keySeq } from "../harness/script"
import { modeline } from "../harness/display"
import { makeEditor } from "../plugins/helper"

// t-9e792ef9: modeline rendered the raw mark byte offset (`mark=541`) whenever
// buffer.mark was set — including after M-> / isearch-exit, which set the mark
// without activating it. Show region size `(N chars)` only while markActive.
test("modeline: no raw mark= offset; region size only while mark is active", async () => {
  const editor = makeEditor()
  const buf = editor.scratch("a.txt", "alpha\nbravo\ncharlie\ndelta\n", "text")

  await keySeq(editor, "M->") // sets mark=0, markActive=false, point at eob
  expect(buf.mark).not.toBeNull()
  expect(modeline(editor)).not.toMatch(/mark=|chars\)/)

  buf.point = 0
  await keySeq(editor, "C-Space", "C-n", "C-n") // active region
  expect(modeline(editor)).toMatch(/\(12 chars\)/)
  expect(modeline(editor)).not.toContain("mark=")
})
