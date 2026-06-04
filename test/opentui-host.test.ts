import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { buildDisplayModel } from "../src/display/build-display-model"
import { themedTextPlain } from "../src/display/themed-text"
import { Editor } from "../src/kernel/editor"
import { installDefaultConfig } from "../src/config"
import { installDefaultModes } from "../src/modes/default-modes"
import { OpenTuiHost } from "../src/ui/opentui-host"

test("OpenTuiHost present renders buffer text in test terminal", async () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("host-test", "visible-body-text", "text")

  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width: 80,
    height: 24,
  })

  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24, cols: 80 } })
  const host = await OpenTuiHost.forRenderer(renderer)
  host.present(model)
  await renderOnce()
  expect(captureCharFrame()).toContain("isible-body-text")
  host.destroy()
})

test("split window produces split display node", async () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("a", "aaa", "text")
  await editor.run("split-window-below")
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 30, cols: 80 } })
  expect(model.windows.kind).toBe("split")
})

test("buildDisplayModel modeline includes mode name", () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("ml", "x", "text")
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24 } })
  const leaf = model.windows.kind === "leaf" ? model.windows.pane : null
  expect(themedTextPlain(leaf!.modeline)).toContain("text")
})
