import type { Editor } from "../kernel/editor"

/** Personal Jemacs preferences (line numbers, extra keymaps, etc.). */
export function installUserConfig(editor: Editor): void {
  editor.enableMinorMode("linum-mode")
}
