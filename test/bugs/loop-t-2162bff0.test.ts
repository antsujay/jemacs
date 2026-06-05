import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { keySeq } from "../harness"
import { install } from "../../plugins/comment-dwim"

// t-2162bff0: terminals can't encode C-;, so C-x C-; (comment-line) is GUI-only.
// C-c ; is the terminal-reachable alias — verify it dispatches through handleKey.
test("comment-line: C-c ; alias reaches comment-line via key dispatch", async () => {
  const editor = makeEditor()
  install(editor)
  const buffer = editor.scratch("*t*", "alpha\nbeta\n", "javascript")
  buffer.point = 2
  await keySeq(editor, "C-c", ";")
  expect(buffer.text).toBe("// alpha\nbeta\n")
  expect(buffer.point).toBe(9)
})
