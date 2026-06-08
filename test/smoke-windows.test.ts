import { expect, test } from "bun:test"
import { buildDisplayModel } from "../src/display/build-display-model"
import { findPaneInModel } from "../src/display/find-pane"
import { Editor } from "../src/kernel/editor"
import { listWindowLeaves } from "../src/kernel/window"
import { installDefaultConfig as installDefaultCommands } from "../src/config"

/** Headless checks for multi-window display model (manual TUI/GUI smoke still useful). */
test("smoke: split and other-window update display model", async () => {
  const editor = new Editor()
  installDefaultCommands(editor)
  editor.scratch("one", "buffer-one", "text")
  await editor.run("split-window-below")
  const leaves = listWindowLeaves(editor.windowLayout)
  expect(leaves).toHaveLength(2)
  const afterSplit = editor.selectedWindowId
  expect(afterSplit).toBe(leaves[0]!.id)

  await editor.run("other-window")
  expect(editor.selectedWindowId).toBe(leaves[1]!.id)
  expect(editor.selectedWindowId).not.toBe(afterSplit)

  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 30, cols: 80 } })
  expect(model.windows.kind).toBe("split")
  expect(findPaneInModel(model.windows, leaves[0]!.id)?.selected).toBe(false)
  expect(findPaneInModel(model.windows, leaves[1]!.id)?.selected).toBe(true)
})
