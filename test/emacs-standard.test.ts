import { expect, test } from "bun:test"
import { Editor } from "../src/kernel/editor"
import { installDefaultConfig as installDefaultCommands } from "../src/config"

test("GNU standard keys from emacs-standard are bound", () => {
  const editor = new Editor()
  installDefaultCommands(editor)

  expect(editor.keymap.get("C-/")).toBe("undo")
  expect(editor.keymap.get("M-y")).toBe("yank-pop")
  expect(editor.keymap.get("C-x 2")).toBe("split-window-below")
  expect(editor.keymap.get("C-x k")).toBe("kill-buffer")
  expect(editor.keymap.get("M-g g")).toBe("goto-line")
  expect(editor.keymap.get("C-x r SPC")).toBe("point-to-register")
  expect(editor.keymap.get("C-h f")).toBe("describe-function")
  expect(editor.keymap.get("C-h c")).toBe("describe-mode")
  expect(editor.keymap.get("C-h m")).toBe("describe-mode")
})

test("beginning-of-buffer and end-of-buffer move point", async () => {
  const editor = new Editor()
  installDefaultCommands(editor)
  editor.currentBuffer.setText("one\ntwo\nthree", false)
  editor.currentBuffer.point = 5

  await editor.run("end-of-buffer")
  expect(editor.currentBuffer.point).toBe(editor.currentBuffer.text.length)

  await editor.run("beginning-of-buffer")
  expect(editor.currentBuffer.point).toBe(0)
})
