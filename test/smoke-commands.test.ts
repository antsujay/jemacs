import { expect, test } from "bun:test"
import { Editor } from "../src/kernel/editor"
import { installDefaultCommands } from "../src/init/default-commands"

test("smoke: M-x keyboard-quit and prefix navigation", async () => {
  const editor = new Editor()
  installDefaultCommands(editor)
  editor.currentBuffer.setText("hello", false)
  editor.currentBuffer.mark = 0
  editor.currentBuffer.point = 5

  await editor.run("keyboard-quit")
  expect(editor.currentBuffer.mark).toBeNull()

  editor.currentBuffer.setText("0123456789", false)
  editor.currentBuffer.point = 0
  await editor.handleKey({ name: "u", ctrl: true })
  await editor.handleKey({ name: "5", sequence: "5" })
  await editor.handleKey({ name: "f", ctrl: true })
  expect(editor.currentBuffer.point).toBe(5)
})
