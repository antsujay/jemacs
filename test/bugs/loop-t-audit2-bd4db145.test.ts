import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { spawnProcess } from "../../src/platform/runtime"
import { entryAtPoint, install } from "../../plugins/magit"

let repo: string

async function git(args: string[]): Promise<void> {
  const proc = spawnProcess({ cmd: ["git", ...args], cwd: repo, stdout: "pipe", stderr: "pipe" })
  await proc.exited
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "jemacs-magit-bd4db145-"))
  await git(["init", "-q", "-b", "main"])
  await git(["config", "user.email", "test@example.com"])
  await git(["config", "user.name", "test"])
  const body = Array.from({ length: 12 }, (_, i) => `line${i}\n`).join("")
  await writeFile(join(repo, "a.txt"), body)
  await writeFile(join(repo, "b.txt"), body)
  await git(["add", "."])
  await git(["commit", "-q", "-m", "initial"])
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

function ed() {
  const editor = makeEditor()
  install(editor)
  return editor
}

function pointAt(text: string, needle: string): number {
  const i = text.indexOf(needle)
  if (i < 0) throw new Error(`not found: ${needle}`)
  return i
}

// t-audit2-bd4db145: magit-section-toggle computed point from a default-context
// (-U3) buildStatus, so when the live buffer used a wider context the computed
// startLine offset pointed into a different section. Regression: bump context
// above the default and verify TAB on the second file lands back on its header.
test("magit-section-toggle places point correctly when diff context > default", async () => {
  const body = Array.from({ length: 12 }, (_, i) => `line${i}\n`).join("")
  await writeFile(join(repo, "a.txt"), body.replace("line5", "LINE5"))
  await writeFile(join(repo, "b.txt"), body.replace("line5", "LINE5"))
  const editor = ed()
  await editor.run("magit-status", [repo])
  for (let i = 0; i < 4; i++) await editor.run("magit-diff-more-context")
  let buf = editor.currentBuffer
  expect(buf.locals.get("magit-diff-context")).toBe(7)

  buf.point = pointAt(buf.text, "modified   b.txt")
  await editor.run("magit-section-toggle")
  buf = editor.currentBuffer
  expect(entryAtPoint(buf)?.file).toBe("b.txt")

  // Round-trip: unfolding must also land on b.txt, not drift into a.txt's hunk.
  await editor.run("magit-section-toggle")
  buf = editor.currentBuffer
  expect(entryAtPoint(buf)?.file).toBe("b.txt")
  expect(buf.locals.get("magit-diff-context")).toBe(7)
})

// t-audit2-06125734 (merged): magit-discard on an untracked file used to fall
// through to `git checkout -- <file>`, which fails because there is no
// HEAD/index version. Discarding an untracked file means deleting it.
test("magit-discard on an untracked file removes it", async () => {
  await writeFile(join(repo, "scratch.txt"), "junk\n")
  const editor = ed()
  await editor.run("magit-status", [repo])
  const buf = editor.currentBuffer
  buf.point = pointAt(buf.text, "untracked  scratch.txt")

  let last = ""
  editor.events.on("message", ({ text }) => { last = text })
  editor.prompt = async () => "y"
  await editor.run("magit-discard")

  expect(last).not.toMatch(/checkout failed|error/i)
  expect(last).toContain("Discarded scratch.txt")
  expect(existsSync(join(repo, "scratch.txt"))).toBe(false)
  expect(editor.currentBuffer.text).not.toContain("scratch.txt")
})
