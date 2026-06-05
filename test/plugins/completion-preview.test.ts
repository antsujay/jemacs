import { describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import {
  install,
  completionPreviewOverlay,
  COMPLETION_PREVIEW_LOCAL,
} from "../../plugins/completion-preview"
import { setCustom } from "../../src/runtime/custom"
import type { Editor } from "../../src/kernel/editor"
import type { Completer } from "../../src/kernel/editor"

async function type(editor: Editor, chars: string): Promise<void> {
  for (const ch of chars) await editor.handleKey({ name: ch, sequence: ch })
}

function setup(mode = "javascript"): Editor {
  const editor = makeEditor()
  install(editor)
  editor.enableMinorMode("completion-preview-mode")
  const buf = editor.currentBuffer
  buf.setText("", false)
  buf.point = 0
  editor.enterMode(buf, mode)
  return editor
}

describe("completion-preview-mode", () => {
  test("toggle command enables and disables the global minor mode", async () => {
    const editor = makeEditor()
    install(editor)
    expect(editor.isMinorModeEnabled("completion-preview-mode")).toBe(false)
    await editor.run("completion-preview-mode")
    expect(editor.isMinorModeEnabled("completion-preview-mode")).toBe(true)
    expect(editor.globalMinorModes.has("completion-preview-mode")).toBe(true)
    await editor.run("completion-preview-mode")
    expect(editor.isMinorModeEnabled("completion-preview-mode")).toBe(false)
  })

  test("self-insert in a prog-mode buffer shows the suffix overlay", async () => {
    const editor = setup()
    await type(editor, "ret")
    const overlay = completionPreviewOverlay(editor.currentBuffer)
    expect(overlay).not.toBeNull()
    expect(overlay!.prefix).toBe("ret")
    expect(overlay!.suffix).toBe("urn")
    expect(overlay!.candidate).toBe("return")
    expect(overlay!.point).toBe(3)
    expect(editor.currentBuffer.text).toBe("ret")
  })

  test("active-mode is enabled while a preview is showing", async () => {
    const editor = setup()
    await type(editor, "ret")
    expect(editor.isMinorModeEnabled("completion-preview-active-mode")).toBe(true)
    await editor.run("forward-char")
    expect(editor.isMinorModeEnabled("completion-preview-active-mode")).toBe(false)
  })

  test("TAB accepts the preview and inserts the suffix", async () => {
    const editor = setup()
    await type(editor, "ret")
    await editor.handleKey({ name: "tab" })
    expect(editor.currentBuffer.text).toBe("return")
    expect(editor.currentBuffer.point).toBe(6)
    expect(completionPreviewOverlay(editor.currentBuffer)).toBeNull()
    expect(editor.isMinorModeEnabled("completion-preview-active-mode")).toBe(false)
  })

  test("non-prog-mode buffers never show a preview", async () => {
    const editor = setup("text")
    await type(editor, "ret")
    expect(completionPreviewOverlay(editor.currentBuffer)).toBeNull()
  })

  test("prefix shorter than the minimum length shows nothing", async () => {
    const editor = setup()
    await type(editor, "re")
    expect(completionPreviewOverlay(editor.currentBuffer)).toBeNull()
    await type(editor, "t")
    expect(completionPreviewOverlay(editor.currentBuffer)?.candidate).toBe("return")
  })

  test("respects completion-preview-minimum-symbol-length defcustom", async () => {
    const editor = setup()
    setCustom("completion-preview-minimum-symbol-length", 1)
    await type(editor, "y")
    expect(completionPreviewOverlay(editor.currentBuffer)?.candidate).toBe("yield")
    setCustom("completion-preview-minimum-symbol-length", 3)
  })

  test("any other command hides the preview", async () => {
    const editor = setup()
    await type(editor, "ret")
    expect(completionPreviewOverlay(editor.currentBuffer)).not.toBeNull()
    await editor.run("move-beginning-of-line")
    expect(completionPreviewOverlay(editor.currentBuffer)).toBeNull()
  })

  test("disabling the mode hides the preview", async () => {
    const editor = setup()
    await type(editor, "ret")
    expect(editor.currentBuffer.locals.has(COMPLETION_PREVIEW_LOCAL)).toBe(true)
    editor.disableMinorMode("completion-preview-mode")
    expect(editor.currentBuffer.locals.has(COMPLETION_PREVIEW_LOCAL)).toBe(false)
  })

  test("does nothing when the mode is disabled", async () => {
    const editor = makeEditor()
    install(editor)
    editor.enterMode(editor.currentBuffer, "javascript")
    editor.currentBuffer.setText("", false)
    editor.currentBuffer.point = 0
    await type(editor, "ret")
    expect(completionPreviewOverlay(editor.currentBuffer)).toBeNull()
  })

  test("no preview when point is in the middle of a word", async () => {
    const editor = setup()
    editor.currentBuffer.setText("retXX", false)
    editor.currentBuffer.point = 2
    await type(editor, "u")
    expect(editor.currentBuffer.text).toBe("reutXX")
    expect(completionPreviewOverlay(editor.currentBuffer)).toBeNull()
  })

  test("ranks candidates with editor.completer and rejects non-prefix top result", async () => {
    const editor = setup()
    editor.currentBuffer.setText("typescript types\n", false)
    editor.currentBuffer.point = editor.currentBuffer.text.length
    const calls: Array<{ input: string; collection: string[] }> = []
    const completer: Completer = (input, collection) => {
      calls.push({ input, collection })
      return [...collection].sort((a, b) => b.length - a.length)
    }
    editor.completer = completer
    await type(editor, "typ")
    expect(calls.at(-1)?.input).toBe("typ")
    expect(calls.at(-1)?.collection).toContain("typescript")
    expect(completionPreviewOverlay(editor.currentBuffer)?.candidate).toBe("typescript")

    editor.completer = (_input, collection) => ["zzz", ...collection]
    await type(editor, "e")
    expect(completionPreviewOverlay(editor.currentBuffer)).toBeNull()
  })

  test("continued typing updates the overlay suffix", async () => {
    const editor = setup()
    await type(editor, "fun")
    expect(completionPreviewOverlay(editor.currentBuffer)?.suffix).toBe("ction")
    await type(editor, "c")
    expect(completionPreviewOverlay(editor.currentBuffer)?.suffix).toBe("tion")
  })
})
