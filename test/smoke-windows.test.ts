import { expect, test } from "bun:test"
import { buildDisplayModel } from "../src/display/build-display-model"
import { findPaneInModel } from "../src/display/find-pane"
import { Editor } from "../src/kernel/editor"
import { listWindowLeaves } from "../src/kernel/window"
import { installDefaultCommands } from "../src/init/default-commands"

/** Headless checks for multi-window display model (manual TUI/GUI smoke still useful). */
test("smoke: split and other-window update display model", async () => {
  const editor = new Editor()
  installDefaultCommands(editor)
  editor.scratch("one", "buffer-one", "text")
  await editor.run("split-window-below")
  expect(listWindowLeaves(editor.windowLayout)).toHaveLength(2)
  const afterSplit = editor.selectedWindow
  expect(afterSplit).toBe(1)

  await editor.run("other-window")
  expect(editor.selectedWindow).toBe(0)
  expect(editor.selectedWindow).not.toBe(afterSplit)

  const leaves = listWindowLeaves(editor.windowLayout)
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 30, cols: 80 } })
  expect(model.windows.kind).toBe("split")
  expect(findPaneInModel(model.windows, leaves[0]!.id)?.selected).toBe(true)
  expect(findPaneInModel(model.windows, leaves[1]!.id)?.selected).toBe(false)
})
