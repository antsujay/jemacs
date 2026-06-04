import { expect, test } from "bun:test"
import { PrefixArgumentState } from "../src/kernel/prefix-argument"
import { Editor } from "../src/kernel/editor"
import { installDefaultConfig } from "../src/config"

test("PrefixArgumentState C-u multiplies by 4", () => {
  const p = new PrefixArgumentState()
  expect(p.universalArgument()).toBe(4)
  expect(p.universalArgument()).toBe(16)
  expect(p.consume()).toBe(16)
  expect(p.peek()).toBeNull()
})

test("PrefixArgumentState C-u digit sets argument", () => {
  const p = new PrefixArgumentState()
  p.universalArgument()
  p.addDigit(5)
  expect(p.consume()).toBe(5)
})

test("PrefixArgumentState M-- negates", () => {
  const p = new PrefixArgumentState()
  p.universalArgument()
  p.toggleNegative()
  expect(p.consume()).toBe(-4)
})

test("C-u 5 f moves five characters via keymap", async () => {
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.currentBuffer.setText("abcdef", false)
  editor.currentBuffer.point = 0

  await editor.handleKey({ name: "u", ctrl: true })
  await editor.handleKey({ name: "5", sequence: "5" })
  expect(await editor.handleKey({ name: "f", ctrl: true })).toEqual({ status: "command", command: "forward-char" })
  expect(editor.currentBuffer.point).toBe(5)
})

test("self-insert-command is used for printable keys", async () => {
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.currentBuffer.setText("", false)

  const result = await editor.handleKey({ name: "a", sequence: "a" })
  expect(result).toEqual({ status: "command", command: "self-insert-command" })
  expect(editor.currentBuffer.text).toBe("a")
})
