import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BufferModel } from "../../src/kernel/buffer"
import { script, keySeq } from "../harness"

// t-a58656 — kill-buffer on a modified file buffer dropped unsaved edits with
// no confirmation. Emacs gates on `Buffer X modified; kill anyway?`; 1de8aba
// fixed displayName resolution (t-dbbf0b) but left the kill unconditional.

const settle = () => new Promise(r => setTimeout(r, 0))

async function dirtyFileBuffer() {
  const editor = await script({ plugins: false }).done()
  const a = editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/a/same.txt", text: "" }))
  editor.switchToBuffer(a.id)
  a.insert("DIRTY")
  expect(a.dirty).toBe(true)
  editor.completingRead = (_p, opts) => Promise.resolve(opts.initialValue ?? null)
  return { editor, a }
}

test("kill-buffer: modified file buffer prompts; 'n' keeps the buffer and its edits", async () => {
  const { editor, a } = await dirtyFileBuffer()
  let prompted = ""
  editor.events.on("message", ({ text }) => { if (text.includes("modified")) prompted = text })
  const done = editor.run("kill-buffer")
  await settle()
  await keySeq(editor, "n")
  await done
  expect(prompted).toContain("same.txt")
  expect(editor.buffers.has(a.id)).toBe(true)
  expect(a.text).toBe("DIRTY")
  expect(a.dirty).toBe(true)
})

test("kill-buffer: 'y' at the modified prompt kills without saving", async () => {
  const { editor, a } = await dirtyFileBuffer()
  const done = editor.run("kill-buffer")
  await settle()
  await keySeq(editor, "y")
  await done
  expect(editor.buffers.has(a.id)).toBe(false)
})

test("kill-buffer: 's' saves then kills", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jemacs-kill-"))
  const path = join(dir, "same.txt")
  writeFileSync(path, "")
  const editor = await script({ plugins: false }).done()
  const a = editor.addBuffer(new BufferModel({ name: "same.txt", path, text: "" }))
  editor.switchToBuffer(a.id)
  a.insert("DIRTY")
  editor.completingRead = (_p, opts) => Promise.resolve(opts.initialValue ?? null)
  const done = editor.run("kill-buffer")
  await settle()
  await keySeq(editor, "s")
  await done
  expect(editor.buffers.has(a.id)).toBe(false)
  expect(readFileSync(path, "utf8")).toBe("DIRTY")
})

test("kill-buffer: unmodified file buffer kills without prompting", async () => {
  const editor = await script({ plugins: false }).done()
  const a = editor.addBuffer(new BufferModel({ name: "clean.txt", path: "/tmp/qa-fix/clean.txt", text: "x" }))
  editor.switchToBuffer(a.id)
  expect(a.dirty).toBe(false)
  editor.completingRead = (_p, opts) => Promise.resolve(opts.initialValue ?? null)
  await editor.run("kill-buffer")
  expect(editor.buffers.has(a.id)).toBe(false)
})

test("kill-buffer: dirty buffer with no path (scratch-like) kills without prompting", async () => {
  const editor = await script({ plugins: false }).done()
  const a = editor.addBuffer(new BufferModel({ name: "*draft*", text: "" }))
  editor.switchToBuffer(a.id)
  a.insert("notes")
  expect(a.dirty).toBe(true)
  expect(a.path).toBeUndefined()
  editor.completingRead = (_p, opts) => Promise.resolve(opts.initialValue ?? null)
  await editor.run("kill-buffer")
  expect(editor.buffers.has(a.id)).toBe(false)
})
