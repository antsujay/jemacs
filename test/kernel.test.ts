import { expect, test } from "bun:test"
import { BufferModel } from "../src/kernel/buffer"
import { Keymap } from "../src/kernel/keymap"
import { Editor } from "../src/kernel/editor"

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

test("editor command registry runs commands", async () => {
  const editor = new Editor()
  editor.command("insert-hi", ({ buffer }) => buffer.insert("hi"))
  await editor.run("insert-hi")
  expect(editor.currentBuffer.text).toContain("hi")
})
