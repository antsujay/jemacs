import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { buildDisplayModel } from "../../src/display/build-display-model"
import { spans } from "../harness/display"
import { themedTextPlain } from "../../src/display/themed-text"

test("C-v while marking keeps mark active and extends region", async () => {
  const editor = makeEditor()
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
  editor.scratch("t.txt", lines.join("\n"), "text").point = 0
  await editor.run("set-mark-command")
  await editor.run("scroll-up-command")

  const buffer = editor.currentBuffer
  expect(buffer.markActive).toBe(true)
  expect(buffer.mark).toBe(0)
  expect(buffer.point).toBeGreaterThan(0)

  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 30, cols: 80 } })
  expect(spans(editor, { rows: 30, cols: 80 }).some(s => s.face === "region")).toBe(true)

  const pane = model.windows.kind === "leaf" ? model.windows.pane : null
  const body = themedTextPlain(pane!.body)
  expect(body.includes("█")).toBe(true)
})
