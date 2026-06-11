import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { spawnProcess } from "../../src/platform/runtime"
import { entryAtPoint, install } from "../../plugins/magit"

let repo: string

async function git(args: string[]): Promise<string> {
  const proc = spawnProcess({ cmd: ["git", ...args], cwd: repo, stdout: "pipe", stderr: "pipe" })
  const out = proc.stdout ? await new Response(proc.stdout).text() : ""
  await proc.exited
  return out
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "jemacs-magit-audit2-"))
  await git(["init", "-q", "-b", "main"])
  await git(["config", "user.email", "test@example.com"])
  await git(["config", "user.name", "test"])
  await writeFile(join(repo, "a.txt"), "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n")
  await writeFile(join(repo, "b.txt"), "m1\nm2\nm3\nm4\nm5\nm6\nm7\nm8\n")
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

function pointAtLine(text: string, needle: string): number {
  const i = text.indexOf(needle)
  if (i < 0) throw new Error(`not found in buffer: ${needle}`)
  return i
}

// t-audit2-6b848fc1: magit-patch-save silently clobbers existing files.
test("magit-patch-save prompts before overwriting and aborts on n", async () => {
  await writeFile(join(repo, "a.txt"), "l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\n")
  const editor = ed()
  await editor.run("magit-status", [repo])
  await editor.run("magit-diff-unstaged")
  const patchPath = join(repo, "out.patch")
  await writeFile(patchPath, "precious\n")

  const prompts: string[] = []
  editor.prompt = async p => { prompts.push(p); return "n" }
  await editor.run("magit-patch-save", [patchPath])
  expect(prompts.some(p => p.toLowerCase().includes("overwrite"))).toBe(true)
  expect(await readFile(patchPath, "utf8")).toBe("precious\n")

  editor.prompt = async () => "y"
  await editor.run("magit-patch-save", [patchPath])
  expect(await readFile(patchPath, "utf8")).toContain("diff --git a/a.txt b/a.txt")
})

// t-audit2-bd4db145: magit-section-toggle computes point from a -U3 build,
// so when the buffer's diff context ≠ 3 the cursor lands inside the wrong section.
test("magit-section-toggle places point correctly when diff context ≠ 3", async () => {
  await writeFile(join(repo, "a.txt"), "l1\nl2\nl3\nL4\nl5\nl6\nl7\nl8\n")
  await writeFile(join(repo, "b.txt"), "m1\nm2\nm3\nM4\nm5\nm6\nm7\nm8\n")
  const editor = ed()
  await editor.run("magit-status", [repo])
  // Shrink context to 0 so -U3 offsets diverge from the live buffer's.
  await editor.run("magit-diff-less-context")
  await editor.run("magit-diff-less-context")
  await editor.run("magit-diff-less-context")
  let buf = editor.currentBuffer
  expect(buf.locals.get("magit-diff-context")).toBe(0)

  buf.point = pointAtLine(buf.text, "modified   b.txt")
  await editor.run("magit-section-toggle")
  buf = editor.currentBuffer
  // Cursor must land back on b.txt's header — not drift into a.txt's body
  // because the throwaway buildStatus used -U3 line offsets.
  expect(entryAtPoint(buf)?.file).toBe("b.txt")
  expect(buf.locals.get("magit-diff-context")).toBe(0)
})

// t-audit2-06125734: magit-discard on an untracked file errors instead of removing it.
test("magit-discard removes an untracked file instead of erroring", async () => {
  await writeFile(join(repo, "new.txt"), "scratch\n")
  const editor = ed()
  await editor.run("magit-status", [repo])
  let buf = editor.currentBuffer
  expect(buf.text).toContain("untracked  new.txt")
  buf.point = pointAtLine(buf.text, "untracked  new.txt")

  let last = ""
  editor.events.on("message", ({ text }) => { last = text })
  editor.prompt = async () => "y"
  await editor.run("magit-discard")

  expect(last).not.toContain("git checkout failed")
  expect(existsSync(join(repo, "new.txt"))).toBe(false)
  expect(editor.currentBuffer.text).not.toContain("untracked  new.txt")
})
