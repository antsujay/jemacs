import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BufferModel } from "../../src/kernel/buffer"
import { getHooks } from "../../src/kernel/hooks"
import { getMode } from "../../src/modes/mode"
import { installDiffCommands, parseDiffBuffer } from "../../src/modes/diff"
import { disposeAllContexts } from "../../src/runtime/plugin-context"
import { makeEditor } from "../plugins/helper"

let dir = ""
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "jemacs-diff-audit-")) })
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

const twoHunk = [
  "--- a/file.txt",
  "+++ b/file.txt",
  "@@ -1,2 +1,2 @@",
  " ctx1",
  "-old1",
  "+new1",
  "@@ -10,2 +10,2 @@",
  " ctx2",
  "-old2",
  "+new2",
  "",
].join("\n")

// t-audit2-6a1d7cf8: a malicious patch with ../ must not resolve outside
// diff-default-directory.
test("diff-goto-source refuses ../ traversal outside default-directory", async () => {
  const project = join(dir, "project")
  await mkdir(project, { recursive: true })
  await writeFile(join(project, "safe.txt"), "in\n")
  await writeFile(join(dir, "secret.txt"), "out\n")
  const editor = makeEditor()
  const diff = [
    "--- a/../secret.txt",
    "+++ b/../secret.txt",
    "@@ -1 +1 @@",
    "-out",
    "+pwn",
    "",
  ].join("\n")
  const buffer = editor.scratch("evil.diff", diff, "diff-mode")
  buffer.locals.set("diff-default-directory", project)
  buffer.point = diff.indexOf("@@")
  await editor.run("diff-goto-source")
  // Must NOT have opened the file that lives outside `project`.
  expect(editor.currentBuffer.path).not.toBe(join(dir, "secret.txt"))
})

test("diff-find-file-name refuses ../ traversal outside default-directory", async () => {
  const project = join(dir, "project")
  await mkdir(project, { recursive: true })
  await writeFile(join(dir, "secret.txt"), "out\n")
  const editor = makeEditor()
  let msg = ""
  editor.events.on("message", ({ text }) => { msg = text })
  const diff = "--- a/../secret.txt\n+++ b/../secret.txt\n@@ -1 +1 @@\n-x\n+y\n"
  const buffer = editor.scratch("evil.diff", diff, "diff-mode")
  buffer.locals.set("diff-default-directory", project)
  buffer.point = 0
  await editor.run("diff-find-file-name")
  expect(msg).not.toBe(join(dir, "secret.txt"))
})

// t-audit2-1448bcd7: hunk #2's extracted patch must not contain hunk #1 body lines.
test("patch extracted for hunk #2 contains only file header + hunk #2", async () => {
  const editor = makeEditor()
  const buffer = editor.scratch("two.diff", twoHunk, "diff-mode")
  buffer.locals.set("diff-default-directory", dir)
  buffer.point = twoHunk.indexOf("@@ -10")
  let msg = ""
  editor.events.on("message", ({ text }) => { msg = text })
  // diff-test-hunk feeds patchForHunk output to `git apply --check`; a leaked
  // body line from hunk #1 makes git reject it as corrupt. Use the message to
  // detect, and also assert via parse round-trip below.
  await editor.run("diff-test-hunk")
  // Independent of git availability: re-derive the patch via the same code path.
  const { patchForHunk } = await import("../../src/modes/diff")
  const file = parseDiffBuffer(buffer)[0]!
  const hunk2 = file.hunks[1]!
  const patch = patchForHunk(buffer, file, hunk2)
  expect(patch).not.toContain("old1")
  expect(patch).not.toContain("new1")
  expect(patch).not.toContain("ctx1")
  expect(patch).toContain("--- a/file.txt")
  expect(patch).toContain("@@ -10,2 +10,2 @@")
  void msg
})

// t-audit2-75500c99: reverse-direction must not corrupt context or normal diffs.
test("diff-reverse-direction round-trips a context diff", async () => {
  const ctxDiff = [
    "*** a.txt",
    "--- b.txt",
    "***************",
    "*** 1,3 ****",
    "  keep",
    "! before",
    "  keep2",
    "--- 1,3 ----",
    "  keep",
    "! after",
    "  keep2",
    "",
  ].join("\n")
  const editor = makeEditor()
  const buffer = editor.scratch("c.diff", ctxDiff, "diff-mode")
  await editor.run("diff-reverse-direction")
  await editor.run("diff-reverse-direction")
  expect(buffer.text).toBe(ctxDiff)
})

test("diff-reverse-direction handles normal diff (swaps <,> and a,d)", async () => {
  const normal = "2d1\n< gone\n"
  const editor = makeEditor()
  const buffer = editor.scratch("n.diff", normal, "diff-mode")
  await editor.run("diff-reverse-direction")
  expect(buffer.text).toBe("1a2\n> gone\n")
  await editor.run("diff-reverse-direction")
  expect(buffer.text).toBe(normal)
})

// t-audit2-acf5620e: `\ No newline at end of file` must not shift goto-source target.
test("diff-goto-source ignores no-newline marker when counting lines", async () => {
  await writeFile(join(dir, "f.txt"), "a\nb\nc\n")
  const editor = makeEditor()
  const diff = [
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1,3 +1,3 @@",
    " a",
    "-b",
    "\\ No newline at end of file",
    "+B",
    " c",
    "",
  ].join("\n")
  const buffer = editor.scratch("f.diff", diff, "diff-mode")
  buffer.locals.set("diff-default-directory", dir)
  buffer.point = diff.indexOf(" c")
  await editor.run("diff-goto-source")
  const src = editor.currentBuffer
  expect(src.path).toBe(join(dir, "f.txt"))
  // " c" is the 3rd line in the new file → point should land on line index 2.
  expect(src.lineAt(src.point)).toBe(2)
})

// t-audit2-2d4afff2: save hooks must be owned by a PluginContext so hot-reload
// disposes the prior registration instead of accumulating a new fn ref.
test("diff save-hooks are tracked for disposal (hot-reload safe)", () => {
  const editor = makeEditor() // installDefaultConfig → installDiffCommands
  const before0 = getHooks("before-save-hook").length
  const after0 = getHooks("after-save-hook").length
  expect(before0).toBeGreaterThan(0)
  expect(after0).toBeGreaterThan(0)
  disposeAllContexts(editor)
  expect(getHooks("before-save-hook").length).toBeLessThan(before0)
  expect(getHooks("after-save-hook").length).toBeLessThan(after0)
  // and re-install after dispose still yields exactly one of each
  installDiffCommands(editor)
  installDiffCommands(editor)
  expect(getHooks("before-save-hook").length).toBe(before0)
  expect(getHooks("after-save-hook").length).toBe(after0)
})

// t-audit2-25901610: after-save delete-empty hook must be gated on diff-mode.
test("after-save delete-empty hook ignores non-diff buffers", async () => {
  const editor = makeEditor()
  const path = join(dir, "plain.txt")
  await writeFile(path, "")
  const buffer = await editor.openFile(path)
  expect(buffer.mode).not.toBe("diff-mode")
  // A stray local from elsewhere must not arm deletion on a non-diff buffer.
  buffer.locals.set("diff-delete-empty-files", true)
  for (const hook of getHooks("after-save-hook")) await hook({ editor, buffer })
  // File must still exist.
  await expect(readFile(path, "utf8")).resolves.toBe("")
})

// t-audit2-af93012f: parse is cached per text-revision, not redone every nav keypress.
test("parseDiffBuffer caches while text is unchanged", () => {
  const buffer = new BufferModel({ name: "x.diff", text: twoHunk, mode: "diff-mode" })
  const a = parseDiffBuffer(buffer)
  const b = parseDiffBuffer(buffer)
  expect(a).toBe(b) // identity: cached
  buffer.setText(twoHunk + " ")
  const c = parseDiffBuffer(buffer)
  expect(c).not.toBe(a) // invalidated on edit
})

// t-audit2-cc94b2de: killing the last hunk under a file header removes the header too.
test("diff-hunk-kill removes orphaned file header when no hunks remain", async () => {
  const editor = makeEditor()
  const oneHunk = [
    "diff --git a/only.txt b/only.txt",
    "--- a/only.txt",
    "+++ b/only.txt",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "",
  ].join("\n")
  const buffer = editor.scratch("o.diff", oneHunk, "diff-mode")
  buffer.point = oneHunk.indexOf("@@")
  await editor.run("diff-hunk-kill")
  expect(buffer.text).not.toContain("--- a/only.txt")
  expect(buffer.text).not.toContain("+++ b/only.txt")
  expect(buffer.text).not.toContain("diff --git")
})

test("killing one of two hunks keeps the file header", async () => {
  const editor = makeEditor()
  const buffer = editor.scratch("two.diff", twoHunk, "diff-mode")
  buffer.point = twoHunk.indexOf("@@ -1,2")
  await editor.run("diff-hunk-kill")
  expect(buffer.text).toContain("--- a/file.txt")
  expect(buffer.text).toContain("@@ -10,2 +10,2 @@")
  expect(buffer.text).not.toContain("old1")
})

// t-audit2-51cb8529: C-c C-s = diff-split-hunk per Emacs (not 'save patch').
test("C-c C-s is bound to diff-split-hunk", () => {
  makeEditor()
  expect(getMode("diff-mode")?.keymap?.get("C-c C-s")).toBe("diff-split-hunk")
})
