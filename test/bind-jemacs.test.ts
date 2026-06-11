import { expect, test } from "bun:test"
import { bindJemacsHost } from "../src/run"
import { Editor } from "../src/kernel/editor"
import type { DisplayModel, InputHandler, UiHost } from "../src/display/protocol"
import type { ViewportSize } from "../src/display/viewport"
import { findWindowLeaf } from "../src/kernel/window"

class StubHost implements UiHost {
  readonly label = "stub"
  readonly capabilities = { unit: "cells" as const, mouse: false, clipboard: false, osc52: false }
  models: DisplayModel[] = []
  inputs: InputHandler[] = []

  async start(): Promise<void> {}
  destroy(): void {}
  present(model: DisplayModel): void {
    this.models.push(model)
  }
  getViewport(): ViewportSize {
    return { rows: 24, cols: 80 }
  }
  onInput(handler: InputHandler): void {
    this.inputs.push(handler)
  }
  onResize(): void {}
}

test("bindJemacsHost presents and routes paste input", async () => {
  const editor = new Editor()
  editor.scratch("bind", "", "text")
  const host = new StubHost()
  const { present, onInput } = bindJemacsHost(editor, host)
  present()
  expect(host.models.length).toBe(1)
  await onInput({ type: "paste", text: "hi" })
  expect(editor.currentBuffer.text).toBe("hi")
})

test("bindJemacsHost routes wheel input to window scrolling", async () => {
  const editor = new Editor()
  editor.scratch("wheel.txt", Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"), "text")
  const host = new StubHost()
  const { present, onInput } = bindJemacsHost(editor, host)
  present()

  const windowId = editor.selectedWindowId
  await onInput({ type: "wheel", windowId, lines: 3 })
  expect(findWindowLeaf(editor.windowLayout, windowId)!.startLine).toBe(3)

  await onInput({ type: "wheel", windowId, lines: -2 })
  expect(findWindowLeaf(editor.windowLayout, windowId)!.startLine).toBe(1)
})
