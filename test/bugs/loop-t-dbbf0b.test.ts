import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { script } from "../harness"

// t-dbbf0b — kill-buffer on duplicate-named buffers killed the wrong one.
// Repro: open a/same.txt, dirty it, open b/same.txt, C-x k RET. The prompt was
// prefilled with raw `buffer.name` ("same.txt") and killBuffer resolved by raw
// name → first insertion-order match (a), silently dropping unsaved edits while
// b stayed current. Uniquify (8389908) only threaded display names through
// switch-to-buffer/modeline/title; this pins the kill-buffer path.
test("kill-buffer: accepting the default kills the current buffer, not its name-twin", async () => {
  const editor = await script().done()
  const a = editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/a/same.txt", text: "" }))
  const b = editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/b/same.txt", text: "" }))
  editor.switchToBuffer(a.id)
  a.insert("DIRTY")
  expect(a.dirty).toBe(true)
  editor.switchToBuffer(b.id)
  expect(editor.currentBuffer.id).toBe(b.id)

  // Simulate C-x k RET: capture what the prompt offers and accept the default.
  let seen: { collection?: string[]; initialValue?: string } = {}
  editor.completingRead = (_prompt, opts) => {
    seen = { collection: opts.collection, initialValue: opts.initialValue }
    return Promise.resolve(opts.initialValue ?? null)
  }
  await editor.run("kill-buffer")

  // The collection must be unambiguous and the default must name the current buffer.
  expect(seen.collection).toContain("same.txt<a>")
  expect(seen.collection).toContain("same.txt<b>")
  expect(seen.collection!.filter(n => n === "same.txt")).toHaveLength(0)
  expect(seen.initialValue).toBe("same.txt<b>")

  // b is gone; a — the dirty one — survives untouched.
  expect(editor.buffers.has(b.id)).toBe(false)
  expect(editor.buffers.has(a.id)).toBe(true)
  expect(a.text).toBe("DIRTY")
  expect(a.dirty).toBe(true)
})

test("killBuffer resolves uniquified display names", async () => {
  const editor = await script().done()
  const a = editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/a/same.txt" }))
  const b = editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/b/same.txt" }))
  // Mirror switchToBuffer's display-name lookup so the command-layer string round-trips.
  const killed = editor.killBuffer(editor.bufferDisplayName(b))
  expect(killed?.id).toBe(b.id)
  expect(editor.buffers.has(a.id)).toBe(true)
})
