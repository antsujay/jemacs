import { expect, test } from "bun:test"
import { buildDisplayModel } from "../src/display/build-display-model"
import { themedTextPlain } from "../src/display/themed-text"
import { contentAreaLines, pageScrollLines, windowBodyLines } from "../src/display/viewport"
import { Editor } from "../src/kernel/editor"
import { installDefaultConfig } from "../src/config"
import { installDefaultModes } from "../src/modes/default-modes"

test("viewport line budgets fill a single-window frame", () => {
  const rows = 24
  expect(contentAreaLines(rows)).toBe(rows - 3)
  expect(pageScrollLines(rows)).toBe(rows - 4)
  expect(windowBodyLines(contentAreaLines(rows))).toBe(pageScrollLines(rows))
})

test("buildDisplayModel body uses full window height minus chrome", () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  const rows = 30
  const lines = Array.from({ length: rows }, (_, i) => `line ${i + 1}`).join("\n")
  editor.scratch("height-test", lines, "text")
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows, cols: 80 } })
  const leaf = model.windows.kind === "leaf" ? model.windows.pane : null
  expect(leaf).not.toBeNull()
  expect(leaf!.bodyLineBudget).toBe(pageScrollLines(rows))
  expect(themedTextPlain(leaf!.body).split("\n").length).toBe(pageScrollLines(rows))
})
