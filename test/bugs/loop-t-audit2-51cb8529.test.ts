import { expect, test } from "bun:test"
import { getMode } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"

// t-audit2-51cb8529: QA brief claimed C-c C-s in diff-mode is "save patch".
// GNU Emacs diff-mode binds C-c C-s to diff-split-hunk; there is no save-patch
// command on that key. The impl was already correct — this locks it in.
test("C-c C-s in diff-mode is diff-split-hunk, not 'save patch'", () => {
  makeEditor()
  expect(getMode("diff-mode")?.keymap?.get("C-c C-s")).toBe("diff-split-hunk")
})

test("C-c C-s actually splits a unified hunk at point", async () => {
  const editor = makeEditor()
  const diff = [
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1,4 +1,4 @@",
    " a",
    "-b",
    "+B",
    " c",
    " d",
    "",
  ].join("\n")
  const buf = editor.scratch("*diff*", diff, "diff-mode")
  buf.point = diff.indexOf(" c")
  expect(editor.keymaps.lookup("C-c C-s")).toMatchObject({ status: "matched", command: "diff-split-hunk" })
  await editor.run("diff-split-hunk")
  expect([...buf.text.matchAll(/^@@ /gm)]).toHaveLength(2)
})
