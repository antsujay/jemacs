import { expect, test } from "bun:test"
import { parseDiffBuffer, patchForHunk } from "../../src/modes/diff"
import { makeEditor } from "../plugins/helper"

// t-audit2-1448bcd7: patchForHunk used to slice the "header" as
// lines[file.startLine .. hunk.startLine], so for hunk N it accumulated the
// body lines of hunks 1..N-1 between the +++ line and the @@ line. git apply
// rejects that as corrupt, breaking C-c C-a / C-c C-t / diff-kill-applied on
// every hunk after the first. Header must end at the *first* hunk's start.
test("patchForHunk: hunk N's patch is file-header + hunk N only (no leaked earlier bodies)", () => {
  const threeHunk = [
    "diff --git a/f.txt b/f.txt",
    "index 0000000..1111111 100644",
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1,2 +1,2 @@",
    " ctxA",
    "-oldA",
    "+newA",
    "@@ -10,2 +10,2 @@",
    " ctxB",
    "-oldB",
    "+newB",
    "@@ -20,2 +20,2 @@",
    " ctxC",
    "-oldC",
    "+newC",
    "",
  ].join("\n")
  const editor = makeEditor()
  const buffer = editor.scratch("three.diff", threeHunk, "diff-mode")
  const file = parseDiffBuffer(buffer)[0]!
  expect(file.hunks.length).toBe(3)

  const header = [
    "diff --git a/f.txt b/f.txt",
    "index 0000000..1111111 100644",
    "--- a/f.txt",
    "+++ b/f.txt",
  ]

  // Hunk #2: must be exactly header + hunk-2 body, nothing from hunk #1.
  const p2 = patchForHunk(buffer, file, file.hunks[1]!)
  expect(p2).toBe([...header, "@@ -10,2 +10,2 @@", " ctxB", "-oldB", "+newB", ""].join("\n"))

  // Hunk #3: regression was cumulative (1..N-1), so check N=3 too.
  const p3 = patchForHunk(buffer, file, file.hunks[2]!)
  expect(p3).toBe([...header, "@@ -20,2 +20,2 @@", " ctxC", "-oldC", "+newC", ""].join("\n"))

  // Hunk #1 stays well-formed (header + its own body).
  const p1 = patchForHunk(buffer, file, file.hunks[0]!)
  expect(p1).toBe([...header, "@@ -1,2 +1,2 @@", " ctxA", "-oldA", "+newA", ""].join("\n"))
})
