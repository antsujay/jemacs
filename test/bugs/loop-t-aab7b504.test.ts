import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { spawnProcess } from "../../src/platform/runtime"
import { hunkAtPoint, install, parseDiff } from "../../plugins/magit"

// t-aab7b504: magit hunk-level stage/unstage. s/u on a @@-hunk should apply
// just that hunk via `git apply --cached`, leaving other hunks in the same
// file untouched. s/u on the file header line keeps whole-file behaviour.

let repo: string

async function git(args: string[]): Promise<string> {
  const proc = spawnProcess({ cmd: ["git", ...args], cwd: repo, stdout: "pipe", stderr: "pipe" })
  const out = proc.stdout ? await new Response(proc.stdout).text() : ""
  await proc.exited
  return out
}

const ORIGINAL = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n"

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "jemacs-magit-hunk-"))
  await git(["init", "-q", "-b", "main"])
  await git(["config", "user.email", "t@e"])
  await git(["config", "user.name", "t"])
  await writeFile(join(repo, "f.txt"), ORIGINAL)
  await git(["add", "."])
  await git(["commit", "-q", "-m", "init"])
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

function ed() {
  const editor = makeEditor()
  install(editor)
  return editor
}

test("parseDiff splits a multi-hunk diff into per-hunk structures with header preserved", () => {
  const diff = [
    "diff --git a/f.txt b/f.txt",
    "index abc..def 100644",
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1,3 +1,3 @@",
    "-line1",
    "+LINE1",
    " line2",
    " line3",
    "@@ -8,3 +8,3 @@",
    " line8",
    "-line9",
    "+LINE9",
    " line10",
    "",
  ].join("\n")
  const files = parseDiff(diff)
  expect(files).toHaveLength(1)
  const fd = files[0]!
  expect(fd.file).toBe("f.txt")
  expect(fd.header).toEqual(["diff --git a/f.txt b/f.txt", "index abc..def 100644", "--- a/f.txt", "+++ b/f.txt"])
  expect(fd.hunks).toHaveLength(2)
  expect(fd.hunks[0]!.header).toBe("@@ -1,3 +1,3 @@")
  expect(fd.hunks[0]!.lines).toEqual(["-line1", "+LINE1", " line2", " line3"])
  expect(fd.hunks[1]!.lines).toContain("+LINE9")
})

test("s on a hunk stages only that hunk; u on a staged hunk unstages it", async () => {
  // Two well-separated edits → git emits two @@ hunks.
  const modified = ORIGINAL.replace("line1\n", "LINE1\n").replace("line9\n", "LINE9\n")
  await writeFile(join(repo, "f.txt"), modified)

  const editor = ed()
  await editor.run("magit-status", [repo])
  let buf = editor.currentBuffer
  expect([...buf.text.matchAll(/^@@ /gm)]).toHaveLength(2)

  // Point on the second hunk's @@ header → stage just that hunk.
  const second = buf.text.indexOf("@@ ", buf.text.indexOf("@@ ") + 1)
  buf.point = second
  const h = hunkAtPoint(buf)
  expect(h?.file).toBe("f.txt")
  expect(h?.staged).toBe(false)
  expect(h?.patch).toContain("+++ b/f.txt")
  expect(h?.patch).toContain("+LINE9")
  expect(h?.patch).not.toContain("+LINE1")

  await editor.handleKey({ name: "s", sequence: "s" })

  const cached = await git(["diff", "--cached"])
  expect(cached).toContain("+LINE9")
  expect(cached).not.toContain("+LINE1")
  const worktree = await git(["diff"])
  expect(worktree).toContain("+LINE1")
  expect(worktree).not.toContain("+LINE9")

  buf = editor.currentBuffer
  expect(buf.text).toContain("Unstaged changes (1)")
  expect(buf.text).toContain("Staged changes (1)")

  // Now unstage that hunk from the Staged section.
  const stagedSection = buf.text.indexOf("Staged changes")
  buf.point = buf.text.indexOf("@@ ", stagedSection)
  expect(hunkAtPoint(buf)?.staged).toBe(true)
  await editor.handleKey({ name: "u", sequence: "u" })

  expect((await git(["diff", "--cached", "--name-only"])).trim()).toBe("")
  expect(editor.currentBuffer.text).not.toContain("Staged changes")
})

test("s on the file header line still stages the whole file", async () => {
  const modified = ORIGINAL.replace("line1\n", "LINE1\n").replace("line9\n", "LINE9\n")
  await writeFile(join(repo, "f.txt"), modified)

  const editor = ed()
  await editor.run("magit-status", [repo])
  const buf = editor.currentBuffer
  buf.point = buf.text.indexOf("modified   f.txt")
  expect(hunkAtPoint(buf)).toBeNull()
  await editor.handleKey({ name: "s", sequence: "s" })

  const cached = await git(["diff", "--cached"])
  expect(cached).toContain("+LINE1")
  expect(cached).toContain("+LINE9")
})
