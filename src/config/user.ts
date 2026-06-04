import type { Editor } from "../kernel/editor"
import { gruvboxDarkHardTheme } from "../themes"

/** Personal Jemacs preferences (line numbers, extra keymaps, etc.). */
export function installUserConfig(editor: Editor): void {
  editor.setTheme(gruvboxDarkHardTheme)
  editor.enableMinorMode("linum-mode")
}
