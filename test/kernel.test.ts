import { expect, test } from "bun:test"
import { BufferModel } from "../src/kernel/buffer"
import { isPrintable, Keymap } from "../src/kernel/keymap"
import { Editor } from "../src/kernel/editor"
import { installDefaultCommands } from "../src/init/default-commands"

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

test("editor command registry runs commands", async () => {
  const editor = new Editor()
  editor.command("insert-hi", ({ buffer }) => buffer.insert("hi"))
  await editor.run("insert-hi")
  expect(editor.currentBuffer.text).toContain("hi")
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
})

test("help keybindings keep C-h as a prefix", () => {
  const editor = new Editor()
  installDefaultCommands(editor)

  expect(editor.keymap.feed({ name: "h", ctrl: true }).status).toBe("pending")
  expect(editor.keymap.feed({ name: "k" })).toEqual({ status: "matched", command: "inspect-keymap" })
})
