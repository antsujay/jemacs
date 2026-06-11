import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getMode } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"

// t-audit2-cc94b2de: killing the last hunk under a ---/+++ header must take
// the header with it; killAppliedHunks must do the same sweep.

let dir = ""
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "jemacs-diff-cc94b2de-")) })
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

test("diff-hunk-kill on the only hunk removes the bare ---/+++ header", async () => {
  const editor = makeEditor()
  const diff = [
    "--- a/only.txt",
    "+++ b/only.txt",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "",
  ].join("\n")
  const buffer = editor.scratch("o.diff", diff, "diff-mode")
  buffer.point = diff.indexOf("@@")
  await editor.run("diff-hunk-kill")
  expect(buffer.text).not.toContain("--- a/only.txt")
  expect(buffer.text).not.toContain("+++ b/only.txt")
  expect(buffer.text).not.toContain("@@")
})

test("diff-kill-applied-hunks prunes the file header once its last hunk is killed", async () => {
  // a.txt on disk already matches the "+" side, so the hunk reverse-applies.
  await writeFile(join(dir, "a.txt"), "after\n")
  const diff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    "",
  ].join("\n")
  const editor = makeEditor()
  const buffer = editor.scratch("*diff*", diff, "diff-mode")
  buffer.locals.set("diff-default-directory", dir)
  buffer.point = diff.indexOf("@@")
  await editor.run("diff-kill-applied-hunks")
  expect(buffer.text).not.toContain("@@")
  // The bug: header lines must not be left orphaned.
  expect(buffer.text).not.toContain("diff --git")
  expect(buffer.text).not.toContain("--- a/a.txt")
  expect(buffer.text).not.toContain("+++ b/a.txt")
})

// merged t-audit2-51cb8529: C-c C-s is diff-split-hunk per Emacs, not "save patch".
test("C-c C-s in diff-mode is diff-split-hunk", () => {
  makeEditor()
  expect(getMode("diff-mode")?.keymap?.get("C-c C-s")).toBe("diff-split-hunk")
})
