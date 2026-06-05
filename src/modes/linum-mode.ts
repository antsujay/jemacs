import type { BufferModel } from "../kernel/buffer"
import type { Editor } from "../kernel/editor"
import { defineMinorMode } from "./minor-mode"

// Global linum is opt-out per buffer kind: the gutter only renders in
// file-visiting buffers by default. Any other buffer (e.g. *scratch*) opts in
// by carrying "linum-mode" in its own minorModes set — which onEnable does for
// the buffer current when `M-x linum-mode` / user.ts turns it on (t-8c81ab4c).
function linumAppliesTo(buffer: BufferModel): boolean {
  return buffer.kind === "file" || buffer.minorModes.has("linum-mode")
}

const gated = new WeakSet<Editor>()

export function installLinumMode(): void {
  defineMinorMode({
    name: "linum-mode",
    lighter: " Lin",
    global: true,
    onEnable: (editor, buffer) => {
      buffer?.minorModes.add("linum-mode")
      if (gated.has(editor)) return
      gated.add(editor)
      // The kernel has no per-buffer suppression of a global minor mode, so
      // gate the one consumer (showLineNumbers) on this editor instance.
      editor.showLineNumbers = (buf = editor.currentBuffer) =>
        editor.isMinorModeEnabled("linum-mode", buf) && linumAppliesTo(buf)
    },
    onDisable: (_editor, buffer) => {
      buffer?.minorModes.delete("linum-mode")
    },
  })
}
