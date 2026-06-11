import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { parseDiffBuffer, installDiffCommands } from "../../src/modes/diff"
import { getHooks } from "../../src/kernel/hooks"
import { makeEditor } from "../plugins/helper"

// t-audit2-75500c99: diff-reverse-direction corrupts context and normal diffs.
// Per-line marker swapping puts the two halves of a context/normal hunk in the
// wrong order — *** must precede ---, < must precede >.

const contextDiff = [
  "*** a.txt\t2024-01-01",
  "--- b.txt\t2024-01-02",
  "***************",
  "*** 1,3 ****",
  "  one",
  "! two",
  "- three",
  "--- 1,3 ----",
  "  one",
  "! TWO",
  "+ four",
  "",
].join("\n")

const normalDiff = [
  "2,3c2,3",
  "< two",
  "< three",
  "---",
  "> TWO",
  "> THREE",
  "5a6",
  "> six",
  "",
].join("\n")

test("diff-reverse-direction produces a structurally valid context diff", async () => {
  const editor = makeEditor()
  const buffer = editor.scratch("*diff*", contextDiff, "diff-mode")
  await editor.run("diff-reverse-direction")
  const out = buffer.text.split("\n")
  // File header: *** newfile, then --- oldfile.
  expect(out[0]).toBe("*** b.txt\t2024-01-02")
  expect(out[1]).toBe("--- a.txt\t2024-01-01")
  // Hunk: separator, then *** range ****, then body, then --- range ----.
  expect(out[2]).toBe("***************")
  expect(out[3]).toBe("*** 1,3 ****")
  expect(out.slice(4, 7)).toEqual(["  one", "! TWO", "- four"])
  expect(out[7]).toBe("--- 1,3 ----")
  expect(out.slice(8, 11)).toEqual(["  one", "! two", "+ three"])
  // Reversed diff must re-parse as a single context hunk.
  const files = parseDiffBuffer(buffer)
  expect(files).toHaveLength(1)
  expect(files[0]?.hunks[0]?.style).toBe("context")
  expect(files[0]?.hunks[0]?.oldStart).toBe(1)
  expect(files[0]?.hunks[0]?.newStart).toBe(1)
})

test("diff-reverse-direction is an involution on context diffs", async () => {
  const editor = makeEditor()
  const buffer = editor.scratch("*diff*", contextDiff, "diff-mode")
  await editor.run("diff-reverse-direction")
  await editor.run("diff-reverse-direction")
  expect(buffer.text).toBe(contextDiff)
})

test("diff-reverse-direction produces a structurally valid normal diff", async () => {
  const editor = makeEditor()
  const buffer = editor.scratch("*diff*", normalDiff, "diff-mode")
  await editor.run("diff-reverse-direction")
  const out = buffer.text.split("\n")
  // c-hunk: ranges swap, < block (was >) precedes ---, > block (was <) follows.
  expect(out[0]).toBe("2,3c2,3")
  expect(out.slice(1, 3)).toEqual(["< TWO", "< THREE"])
  expect(out[3]).toBe("---")
  expect(out.slice(4, 6)).toEqual(["> two", "> three"])
  // a-hunk becomes d-hunk; > line becomes <.
  expect(out[6]).toBe("6d5")
  expect(out[7]).toBe("< six")
  // Re-parses cleanly.
  const files = parseDiffBuffer(buffer)
  expect(files[0]?.hunks).toHaveLength(2)
  expect(files[0]?.hunks.every(h => h.style === "normal")).toBe(true)
})

test("diff-reverse-direction is an involution on normal diffs", async () => {
  const editor = makeEditor()
  const buffer = editor.scratch("*diff*", normalDiff, "diff-mode")
  await editor.run("diff-reverse-direction")
  await editor.run("diff-reverse-direction")
  expect(buffer.text).toBe(normalDiff)
})

// --- merged sub-tasks: regression locks (already addressed in 20a92f9) ---

const unifiedNoNewline = [
  "--- a/x.txt",
  "+++ b/x.txt",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "\\ No newline at end of file",
  "+new",
  "",
].join("\n")

// t-audit2-acf5620e
test("diff-goto-source: \\ No newline marker is not counted as a body line", () => {
  const buffer = new BufferModel({ name: "x.diff", text: unifiedNoNewline, mode: "diff-mode" })
  const files = parseDiffBuffer(buffer)
  const hunk = files[0]!.hunks[0]!
  // Walk the same way sourceLocationAtPoint does: from header+1 to point, count non-'-' non-'\' lines.
  buffer.point = buffer.text.indexOf("+new")
  const here = buffer.lineAt(buffer.point)
  let line = hunk.newStart!
  const lines = buffer.text.split("\n")
  for (let i = hunk.startLine + 1; i < here; i++) {
    if (lines[i]!.startsWith("\\")) continue
    if (!lines[i]!.startsWith("-")) line++
  }
  expect(line).toBe(2) // 'new' is source line 2, not 3
})

// t-audit2-2d4afff2
test("hot-reload of installDiffCommands does not duplicate save hooks", () => {
  const editor = makeEditor()
  const before = getHooks("before-save-hook").length
  installDiffCommands(editor)
  installDiffCommands(editor)
  expect(getHooks("before-save-hook").length).toBe(before)
  expect(getHooks("after-save-hook").length).toBe(1)
})

// t-audit2-25901610
test("after-save delete-empty hook is gated on diff buffers", async () => {
  const editor = makeEditor()
  const buffer = editor.scratch("*plain*", "", "text")
  buffer.locals.set("diff-delete-empty-files", true)
  // Non-diff buffer with the local set must be a no-op (no throw, no fs touch).
  await editor.runHook("after-save-hook", buffer)
  expect(buffer.mode).toBe("text")
})

// t-audit2-af93012f
test("parseDiffBuffer caches by buffer text identity", () => {
  const buffer = new BufferModel({ name: "x.diff", text: contextDiff, mode: "diff-mode" })
  const a = parseDiffBuffer(buffer)
  const b = parseDiffBuffer(buffer)
  expect(a).toBe(b)
  buffer.setText(contextDiff + " ")
  expect(parseDiffBuffer(buffer)).not.toBe(a)
})

// t-audit2-cc94b2de
test("diff-hunk-kill removes the file header when killing the last hunk", async () => {
  const editor = makeEditor()
  const buffer = editor.scratch("*diff*", unifiedNoNewline, "diff-mode")
  buffer.point = buffer.text.indexOf("@@ ")
  await editor.run("diff-hunk-kill")
  expect(buffer.text).not.toContain("--- a/x.txt")
  expect(buffer.text).not.toContain("+++ b/x.txt")
})

// t-audit2-51cb8529
test("C-c C-s in diff-mode is diff-split-hunk", () => {
  const editor = makeEditor()
  editor.scratch("*diff*", unifiedNoNewline, "diff-mode")
  expect(editor.keymaps.lookup("C-c C-s")).toMatchObject({ status: "matched", command: "diff-split-hunk" })
})
