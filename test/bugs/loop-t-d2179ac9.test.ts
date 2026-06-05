import { test, expect } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { script, keySeq } from "../harness"

// t-d2179ac9 — revert-buffer must confirm before discarding dirty edits;
// noconfirm arg lets auto-revert bypass.

test("revert-buffer: dirty buffer prompts; 'n' keeps edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-d2179-"))
  const path = join(dir, "f.txt")
  await writeFile(path, "disk\n")
  const ed = await script().done()
  await ed.openFile(path)
  ed.currentBuffer.insert("edited ")
  let prompted = ""
  ed.events.on("message", ({ text }) => { if (text.includes("Discard edits")) prompted = text })
  const done = ed.run("revert-buffer")
  await new Promise(r => setTimeout(r, 0))
  expect(prompted).toContain("Discard edits")
  await keySeq(ed, "n")
  await done
  expect(ed.currentBuffer.text).toContain("edited")
  await rm(dir, { recursive: true, force: true })
})

test("revert-buffer: noconfirm arg reverts a dirty buffer without prompting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-d2179-"))
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
  await rm(dir, { recursive: true, force: true })
})

test("revert-buffer: clean buffer reverts without prompting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-d2179-"))
  const path = join(dir, "f.txt")
  await writeFile(path, "disk\n")
  const ed = await script().done()
  await ed.openFile(path)
  await writeFile(path, "changed on disk\n")
  let prompted = false
  ed.events.on("message", ({ text }) => { if (text.includes("Discard edits")) prompted = true })
  await ed.run("revert-buffer")
  expect(prompted).toBe(false)
  expect(ed.currentBuffer.text).toBe("changed on disk\n")
  await rm(dir, { recursive: true, force: true })
})

// t-e8584a11 — forward-word: negative prefix reverses direction; word regex
// is Unicode-aware (letters, combining marks, digits, underscore).

test("forward-word: negative prefix moves backward |N| words", async () => {
  await script()
    .text("foo bar baz").point(11)
    .do(ed => { ed.prefixArg.addDigit(2); ed.prefixArg.toggleNegative() })
    .run("forward-word")
    .expect.point(4)
    .done()
})

test("forward-word: combining-mark sequences are one word (NFD)", async () => {
  const nfd = "café next" // "café next" with combining acute on the e
  await script()
    .text(nfd).point(0)
    .run("forward-word")
    .expect.point(5) // c a f e <combining-acute>
    .done()
})

test("forward-word: CJK script is word-constituent", async () => {
  await script()
    .text("漢字 hello").point(0)
    .run("forward-word")
    .expect.point(2)
    .done()
})

// t-817ee762 — kill-line: prefix arg, blank-tail newline rule, consecutive
// kills append to the kill-ring head.

test("kill-line: C-u 0 kills back to beginning of line", async () => {
  await script()
    .text("foo bar\nbaz").point(4)
    .do(ed => { ed.prefixArg.addDigit(0) })
    .run("kill-line")
    .expect.text("bar\nbaz").expect.point(0)
    .done()
})

test("kill-line: blank-whitespace tail kills through the newline", async () => {
  await script()
    .text("foo  \nbar").point(3)
    .run("kill-line")
    .expect.text("foobar")
    .done()
})

test("kill-line: consecutive kills append; one yank restores all", async () => {
  await script()
    .text("a\nb\nc\n").point(0)
    .run("kill-line").run("kill-line").run("kill-line").run("kill-line")
    .expect.text("c\n")
    .run("yank")
    .expect.text("a\nb\nc\n")
    .done()
})
