import { test, expect } from "bun:test"
import { mkdtemp, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { script, keySeq } from "../harness"

test("revert-buffer on a dirty buffer asks before discarding edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-revert-"))
  const path = join(dir, "f.txt")
  await writeFile(path, "disk\n")
  const ed = await script().done()
  await ed.openFile(path)
  ed.currentBuffer.insert("edited ")
  expect(ed.currentBuffer.dirty).toBe(true)
  let prompted = ""
  ed.events.on("message", ({ text }) => { if (text.includes("Discard edits")) prompted = text })
  const done = ed.run("revert-buffer")
  await new Promise(r => setTimeout(r, 0))
  expect(prompted).toContain("Discard edits")
  await keySeq(ed, "n")
  await done
  expect(ed.currentBuffer.text).toContain("edited")
})

test("revert-buffer with noconfirm arg skips the prompt (for auto-revert)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-revert-"))
  const path = join(dir, "f.txt")
  await writeFile(path, "disk\n")
  const ed = await script().done()
  await ed.openFile(path)
  ed.currentBuffer.insert("edited ")
  let prompted = false
  ed.events.on("message", ({ text }) => { if (text.includes("Discard edits")) prompted = true })
  await ed.run("revert-buffer", ["noconfirm"])
  expect(prompted).toBe(false)
  expect(ed.currentBuffer.text).toBe("disk\n")
  expect(ed.currentBuffer.dirty).toBe(false)
})

test("save-some-buffers saves buffer-save-without-query buffers without prompting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-ssb-"))
  const path = join(dir, "auto.txt")
  await writeFile(path, "")
  const ed = await script().done()
  await ed.openFile(path)
  ed.currentBuffer.insert("auto-saved")
  ed.currentBuffer.locals.set("buffer-save-without-query", true)
  let prompted = false
  ed.events.on("minibuffer", () => { prompted = true })
  await ed.run("save-some-buffers")
  expect(prompted).toBe(false)
  expect(await readFile(path, "utf8")).toBe("auto-saved")
})
