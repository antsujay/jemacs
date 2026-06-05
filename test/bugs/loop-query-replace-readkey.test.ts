import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { script, keySeq } from "../harness"

// inbox 12: query-replace's per-match prompt must read a single key, not a minibuffer line.
test("query-replace: y/n/q dispatch on a single keypress (no RET)", async () => {
  const ed = await script({ plugins: false }).text("aXaXa").point(0).done()
  const done = ed.run("query-replace", ["a", "b"])
  await keySeq(ed, "y") // replace first
  await keySeq(ed, "n") // skip second
  await keySeq(ed, "q") // quit before third
  if (ed.minibuffer) ed.minibufferCancel() // pre-fix: drain the text prompt so `done` settles
  await done
  expect(ed.currentBuffer.text).toBe("bXaXa")
})

test("query-replace: ! replaces all remaining without further prompts", async () => {
  const ed = await script({ plugins: false }).text("a a a").point(0).done()
  const done = ed.run("query-replace", ["a", "b"])
  await keySeq(ed, "!")
  if (ed.minibuffer) ed.minibufferCancel()
  await done
  expect(ed.currentBuffer.text).toBe("b b b")
})

// inbox 35: revert-buffer must confirm before discarding unsaved edits.
test("revert-buffer: dirty buffer prompts; 'n' preserves edits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jemacs-revert-"))
  const path = join(dir, "f.txt")
  writeFileSync(path, "disk")
  const ed = await script({ plugins: false }).done()
  const buf = ed.currentBuffer
  buf.path = path
  buf.setText("edited", false)
  buf.dirty = true
  const done = ed.run("revert-buffer")
  await keySeq(ed, "n")
  await done
  expect(buf.text).toBe("edited")
  expect(buf.dirty).toBe(true)
})

test("revert-buffer: 'y' confirms and reverts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jemacs-revert-"))
  const path = join(dir, "f.txt")
  writeFileSync(path, "disk")
  const ed = await script({ plugins: false }).done()
  const buf = ed.currentBuffer
  buf.path = path
  buf.setText("edited", false)
  buf.dirty = true
  const done = ed.run("revert-buffer")
  await keySeq(ed, "y")
  await done
  expect(buf.text).toBe("disk")
  expect(buf.dirty).toBe(false)
})
