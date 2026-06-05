import { expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { setCustom } from "../../src/runtime/custom"
import { addHook } from "../../src/kernel/hooks"

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "jemacs-sweep-84bf11-")) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const tick = () => new Promise(r => setTimeout(r, 0))
const until = async (pred: () => boolean) => {
  for (let i = 0; i < 200 && !pred(); i++) await tick()
}

// t-sweep-84bf11: kill-buffer and revert-buffer echoed raw buffer.name in user
// messages, so basename-colliding buffers were indistinguishable. Everything
// else (collection, modeline, title) was already migrated to bufferDisplayName.
test("kill-buffer / revert-buffer messages use uniquified display name", async () => {
  const editor = makeEditor()
  let last = ""
  editor.events.on("message", ({ text }) => { last = text })
  await mkdir(join(dir, "a")); await mkdir(join(dir, "b"))
  await writeFile(join(dir, "a", "same.txt"), "aa")
  await writeFile(join(dir, "b", "same.txt"), "bb")
  const a = await editor.openFile(join(dir, "a", "same.txt"))
  const b = await editor.openFile(join(dir, "b", "same.txt"))
  expect(editor.bufferDisplayName(b)).toBe("same.txt<b>")

  editor.switchToBuffer(b.id)
  await editor.run("revert-buffer")
  expect(last).toContain("same.txt<b>")

  await editor.run("kill-buffer", [editor.bufferDisplayName(b)])
  expect(last).toBe("Killed buffer same.txt<b>")
  expect(editor.bufferDisplayName(a)).toBe("same.txt")
})

// t-sweep-d774ef: write-file (C-x C-w) called buffer.save() bare — no
// SaveContext — so make-backup-files was ignored and before/after-save-hook
// never fired. Same bug class as t-20bc93 (save-buffer).
test("write-file threads SaveContext: make-backup-files + save hooks", async () => {
  const editor = makeEditor()
  const path = join(dir, "wf.txt")
  await writeFile(path, "orig")
  const buf = await editor.openFile(path)
  buf.point = 4
  buf.insert("!")

  const fired: string[] = []
  addHook("before-save-hook", () => { fired.push("before") })
  addHook("after-save-hook", () => { fired.push("after") })

  setCustom("make-backup-files", false)
  try {
    await editor.run("write-file", [path])
    expect(await readFile(path, "utf8")).toBe("orig!")
    await expect(readFile(path + "~", "utf8")).rejects.toThrow()
    expect(fired).toEqual(["before", "after"])
  } finally {
    setCustom("make-backup-files", true)
  }
})

// t-sweep-597dae: find-alternate-file (C-x C-v) clobbered a dirty buffer's
// text with no confirm. Emacs prompts "Buffer X modified; kill anyway?" first.
test("find-alternate-file prompts before discarding a dirty buffer", async () => {
  const editor = makeEditor()
  let last = ""
  editor.events.on("message", ({ text }) => { last = text })
  const orig = join(dir, "orig.txt")
  const alt = join(dir, "alt.txt")
  await writeFile(orig, "keep me")
  await writeFile(alt, "replacement")
  const buf = await editor.openFile(orig)
  buf.point = 0
  buf.insert("EDITED ")
  expect(buf.dirty).toBe(true)

  // 'n' → cancel, buffer untouched
  const run1 = editor.run("find-alternate-file", [alt])
  run1.catch(() => {})
  await until(() => last.includes("kill anyway"))
  await editor.handleKey({ name: "n", sequence: "n" })
  await run1
  expect(buf.text).toBe("EDITED keep me")
  expect(buf.path).toBe(orig)
  expect(buf.dirty).toBe(true)

  // 'y' → proceed, buffer replaced
  last = ""
  const run2 = editor.run("find-alternate-file", [alt])
  await until(() => last.includes("kill anyway"))
  await editor.handleKey({ name: "y", sequence: "y" })
  await run2
  expect(buf.text).toBe("replacement")
  expect(buf.path).toBe(alt)
  expect(buf.dirty).toBe(false)
})
