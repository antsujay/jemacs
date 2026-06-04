import { expect, test } from "bun:test"
import { buildDisplayModel } from "../src/display/build-display-model"
import { findPaneInModel } from "../src/display/find-pane"
import { Editor } from "../src/kernel/editor"
import { installDefaultConfig } from "../src/config"
import { installDefaultModes } from "../src/modes/default-modes"

test("editor.clickWindow moves point and selects window", () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("click", "hello\nworld", "text")
  const windowId = editor.selectedWindowId
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24 } })
  const pane = findPaneInModel(model.windows, windowId)!
  editor.clickWindow(windowId, 1, pane.clickState.gutterPrefixLen, pane.clickState, pane.bodyLineBudget)
  expect(editor.currentBuffer.point).toBeGreaterThan(5)
})
