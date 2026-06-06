import { expect, test } from "bun:test"
import { buildDisplayModel } from "../src/display/build-display-model"
import { pointFromWindowClick } from "../src/display/click-to-point"
import { findPaneInModel } from "../src/display/find-pane"
import { Editor } from "../src/kernel/editor"
import { installDefaultConfig } from "../src/config"
import { installDefaultModes } from "../src/modes/default-modes"

test("editor.clickWindow moves point and selects window", () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  const buffer = editor.scratch("click", "hello\nworld", "text")
  const windowId = editor.selectedWindowId
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24 } })
  const pane = findPaneInModel(model.windows, windowId)!
  const point = pointFromWindowClick(buffer.text, pane.clickState, 1, pane.clickState.gutterPrefixLen, pane.bodyLineBudget)
  editor.clickWindow(windowId, point)
  expect(editor.currentBuffer.point).toBeGreaterThan(5)
})
