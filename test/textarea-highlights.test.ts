import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { TextareaRenderable } from "@opentui/core"
import { buildDisplayModel } from "../src/display/build-display-model"
import { Editor } from "../src/kernel/editor"
import { installDefaultConfig } from "../src/config"
import { installDefaultModes } from "../src/modes/default-modes"
import { OpenTuiHost } from "../src/ui/opentui-host"

test("TextareaRenderable sync applies font-lock highlights on full buffer", async () => {
  const prev = process.env.JEMACS_USE_TEXTAREA
  process.env.JEMACS_USE_TEXTAREA = "1"
  try {
    installDefaultModes()
    const editor = new Editor()
    installDefaultConfig(editor)
    editor.scratch("hl", "hello world", "text")
    editor.currentBuffer.mark = 0
    editor.currentBuffer.point = 5

    const { renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 })
    const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24, cols: 80 } })
    const host = await OpenTuiHost.forRenderer(renderer)
    host.present(model)
    await renderOnce()

    const body = renderer.root.findDescendantById(`window-body:${editor.selectedWindowId}`) as TextareaRenderable
    const highlights = body.editBuffer.getLineHighlights(0)
    expect(highlights.length).toBeGreaterThan(0)
    host.destroy()
  } finally {
    if (prev === undefined) delete process.env.JEMACS_USE_TEXTAREA
    else process.env.JEMACS_USE_TEXTAREA = prev
  }
})
