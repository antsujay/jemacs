import { expect, test } from "bun:test"
import { buildDisplayModel } from "../src/display/build-display-model"
import { themedTextPlain } from "../src/display/themed-text"
import { Editor } from "../src/kernel/editor"
import { installDefaultConfig } from "../src/config"
import { installDefaultModes } from "../src/modes/default-modes"
import { defaultTheme } from "../src/themes"

test("buildDisplayModel includes buffer name in title", () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("plan-test", "hello", "text")
  const model = buildDisplayModel(editor, {
    lastMessage: "",
    viewport: { rows: 30, cols: 80 },
    hostLabel: "Jemacs Test",
  })
  expect(themedTextPlain(model.title)).toContain("plan-test")
  expect(themedTextPlain(model.title)).toContain("Jemacs Test")
})

test("buildDisplayModel highlights isearch in selected window", async () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("isearch-test", "find me find", "text")
  await editor.run("isearch-forward")
  editor.isearch!.string = "find"
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 30 } })
  const leaf = model.windows.kind === "leaf" ? model.windows.pane : null
  expect(leaf).not.toBeNull()
  const body = themedTextPlain(leaf!.body)
  expect(body).toContain("find")
})

test("buildDisplayModel uses theme from editor", () => {
  installDefaultModes()
  const editor = new Editor()
  expect(buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24 } }).theme.name)
    .toBe(defaultTheme.name)
})
