import { expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, readFile, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { getCustom, setCustom } from "../../src/runtime/custom"
import { clearAdvice } from "../../src/runtime/advice"
import { clearHooks } from "../../src/kernel/hooks"

let dir: string
beforeEach(async () => {
  // advice/hooks are process-global; other files' script() installs save-hooks
  // (save-buffer advice + before-save-hook) which push the readKey prompt past tick().
  clearAdvice("save-buffer")
  clearHooks("before-save-hook")
  clearHooks("after-save-hook")
  dir = await mkdtemp(join(tmpdir(), "jemacs-t20bc93-"))
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const tick = () => new Promise(r => setTimeout(r, 0))
// confirm prompt is behind an fs.stat (verifyVisitedFileModtime); poll, don't race setTimeout(0).
const until = async (pred: () => boolean) => {
  for (let i = 0; i < 200 && !pred(); i++) await tick()
}

// t-20bc93: C-x C-s on a file changed externally dumped "Error: ... changed on
// disk" + a stack trace into the echo area instead of prompting. save-buffer
// called buffer.save() with no SaveContext, so the t-4b3727be confirm gate was
// never offered and the throw escaped uncaught.
test("save-buffer: mtime clash prompts; 'y' overwrites", async () => {
  const editor = makeEditor()
  let lastMessage = ""
  editor.events.on("message", ({ text }) => { lastMessage = text })
  const path = join(dir, "mtime.txt")
  await writeFile(path, "v1")
  const buf = await editor.openFile(path)
  buf.point = 2
  buf.insert("x")
  const future = Date.now() / 1000 + 60
  await utimes(path, future, future)

  const saving = editor.run("save-buffer")
  saving.catch(() => {}) // pre-fix: rejects before any prompt
  await until(() => lastMessage !== "")
  expect(lastMessage).toContain("save anyway")
  await editor.handleKey({ name: "y", sequence: "y" })
  await saving

  expect(await readFile(path, "utf8")).toBe("v1x")
  expect(buf.dirty).toBe(false)
})

test("save-buffer: mtime clash 'n' cancels cleanly (no uncaught throw)", async () => {
  const editor = makeEditor()
  let lastMessage = ""
  editor.events.on("message", ({ text }) => { lastMessage = text })
  const path = join(dir, "mtime.txt")
  await writeFile(path, "v1")
  const buf = await editor.openFile(path)
  buf.point = 2
  buf.insert("x")
  const future = Date.now() / 1000 + 60
  await utimes(path, future, future)

  const saving = editor.run("save-buffer")
  saving.catch(() => {})
  await until(() => lastMessage !== "")
  await editor.handleKey({ name: "n", sequence: "n" })
  await expect(saving).resolves.toBeUndefined()

  expect(await readFile(path, "utf8")).toBe("v1")
  expect(buf.dirty).toBe(true)
  expect(lastMessage).toContain("changed on disk")
})

// t-20bc93 secondary: make-backup-files defcustom was never threaded; the
// SaveContext comment in buffer.ts says it lives at the command layer.
test("save-buffer: honours make-backup-files defcustom", async () => {
  const editor = makeEditor()
  expect(getCustom<boolean>("make-backup-files")).toBe(true)
  setCustom("make-backup-files", false)
  try {
    const path = join(dir, "nb.txt")
    await writeFile(path, "orig")
    const buf = await editor.openFile(path)
    buf.point = 4
    buf.insert("!")
    await editor.run("save-buffer")
    expect(await readFile(path, "utf8")).toBe("orig!")
    await expect(readFile(path + "~", "utf8")).rejects.toThrow()
  } finally {
    setCustom("make-backup-files", true)
  }
})
