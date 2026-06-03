import { expect, test } from "bun:test"
import { BufferModel } from "../src/kernel/buffer"
import { isPrintable, keyToken, Keymap } from "../src/kernel/keymap"
import { Editor } from "../src/kernel/editor"
import { installDefaultCommands } from "../src/init/default-commands"
import { visibleText } from "../src/ui/opentui"

test("buffer insert/delete/undo", () => {
  const b = new BufferModel({ name: "x", text: "abc" })
  b.point = 1
  b.insert("Z")
  expect(b.text).toBe("aZbc")
  b.deleteBackward()
  expect(b.text).toBe("abc")
  b.undo()
  expect(b.text).toBe("aZbc")
})

test("keymap handles multi-key command sequences", () => {
  const km = new Keymap()
  km.bind("C-x C-s", "save-buffer")
  expect(km.feed({ name: "x", ctrl: true }).status).toBe("pending")
  expect(km.feed({ name: "s", ctrl: true })).toEqual({ status: "matched", command: "save-buffer" })
})

test("space key is printable", () => {
  expect(isPrintable({ name: "space", sequence: " " })).toBe(true)
  expect(isPrintable({ name: "space", sequence: " ", ctrl: true })).toBe(false)
})

test("mac option key sequences map to meta bindings", () => {
  expect(keyToken({ name: "≈", sequence: "≈" })).toBe("M-x")
  expect(keyToken({ name: "ƒ", sequence: "ƒ" })).toBe("M-f")
  expect(keyToken({ name: "∫", sequence: "∫" })).toBe("M-b")
  expect(isPrintable({ name: "≈", sequence: "≈" })).toBe(false)
})

test("visible text cursor does not shift the character under point", () => {
  expect(visibleText("abc", 1)).toBe("a█c")
  expect(visibleText("abc", 3)).toBe("abc█")
})

test("editor command registry runs commands", async () => {
  const editor = new Editor()
  editor.command("insert-hi", ({ buffer }) => buffer.insert("hi"))
  await editor.run("insert-hi")
  expect(editor.currentBuffer.text).toContain("hi")
})

test("editor messages return their text for eval feedback", async () => {
  const editor = new Editor()
  const evaluator = installDefaultCommands(editor)

  await expect(evaluator.evalExpression('editor.message("hello")')).resolves.toBe("hello")
  expect([...editor.buffers.values()].find(b => b.name === "*messages*")?.text).toContain("hello")
})

test("buffer supports emacs-style movement primitives", () => {
  const b = new BufferModel({ name: "x", text: "one two\nthree" })
  b.point = 4
  b.moveWord(1)
  expect(b.point).toBe(7)
  b.moveWord(-1)
  expect(b.point).toBe(4)
  b.moveToLineEnd()
  expect(b.point).toBe(7)
  b.moveLine(1)
  expect(b.lineCol()).toEqual({ line: 2, col: 6 })
  b.moveToLineStart()
  expect(b.point).toBe(8)
})

test("default emacs keybindings are registered and runnable", async () => {
  const editor = new Editor()
  installDefaultCommands(editor)
  editor.currentBuffer.setText("abc\ndef", false)
  editor.currentBuffer.point = 0

  expect(editor.keymap.feed({ name: "f", ctrl: true })).toEqual({ status: "matched", command: "forward-char" })
  await editor.run("forward-char")
  expect(editor.currentBuffer.point).toBe(1)

  await editor.run("end-of-line")
  expect(editor.currentBuffer.point).toBe(3)
  await editor.run("kill-line")
  expect(editor.currentBuffer.text).toBe("abcdef")
  await editor.run("yank")
  expect(editor.currentBuffer.text).toBe("abc\ndef")

  expect(editor.keymap.feed({ name: "x", ctrl: true }).status).toBe("pending")
  expect(editor.keymap.feed({ name: "c", ctrl: true })).toEqual({ status: "matched", command: "quit" })
  expect(editor.keymap.feed({ name: "≈", sequence: "≈" })).toEqual({ status: "matched", command: "run-command" })
  expect(editor.keymap.feed({ name: "escape" }).status).toBe("pending")
  expect(editor.keymap.feed({ name: "x" })).toEqual({ status: "matched", command: "run-command" })
})

test("default commands support buffer listing, switching, newline, and regions", async () => {
  const editor = new Editor()
  installDefaultCommands(editor)
  editor.scratch("notes", "hello world", "text")

  await editor.run("switch-to-buffer", ["*scratch*"])
  expect(editor.currentBuffer.name).toBe("*scratch*")

  expect(editor.keymap.feed({ name: "x", ctrl: true }).status).toBe("pending")
  expect(editor.keymap.feed({ name: "b", ctrl: true })).toEqual({ status: "matched", command: "list-buffers" })
  await editor.run("list-buffers")
  expect(editor.currentBuffer.name).toBe("*Buffer List*")
  expect(editor.currentBuffer.text).toContain("notes")

  await editor.run("switch-to-buffer", ["notes"])
  editor.currentBuffer.point = 5
  await editor.run("newline")
  expect(editor.currentBuffer.text).toBe("hello\n world")

  editor.currentBuffer.mark = 0
  editor.currentBuffer.point = 5
  await editor.run("copy-region")
  editor.currentBuffer.point = editor.currentBuffer.text.length
  await editor.run("yank")
  expect(editor.currentBuffer.text.endsWith("hello")).toBe(true)

  editor.currentBuffer.mark = 0
  editor.currentBuffer.point = 5
  await editor.run("kill-region")
  expect(editor.currentBuffer.text.startsWith("\n world")).toBe(true)
})

test("help keybindings keep C-h as a prefix", () => {
  const editor = new Editor()
  installDefaultCommands(editor)

  expect(editor.keymap.feed({ name: "h", ctrl: true }).status).toBe("pending")
  expect(editor.keymap.feed({ name: "k" })).toEqual({ status: "matched", command: "inspect-keymap" })
})

test("live reload keybinding is registered", () => {
  const editor = new Editor()
  installDefaultCommands(editor)

  expect(editor.keymap.feed({ name: "c", ctrl: true }).status).toBe("pending")
  expect(editor.keymap.feed({ name: "r", ctrl: true })).toEqual({ status: "matched", command: "reload-current-file" })
})
