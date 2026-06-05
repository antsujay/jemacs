import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import type { Editor } from "../kernel/editor"
import { setCustom } from "../runtime/custom"
import { setFaceAttribute } from "../runtime/faces"
import { enableBuiltinTheme } from "../themes"
import { gruvboxDarkHardTheme, install as installGruvboxDarkHardTheme } from "../../plugins/gruvbox-dark-hard"
import { install as installVertico } from "../../plugins/vertico"
import { install as installTiling } from "../../plugins/tiling"
import { install as installWindow } from "../../plugins/window"

export function installStephenConfig(editor: Editor): void {
  // Emacs: (concat temporary-file-directory user-login-name "/")
  const userTemporaryFileDirectory = join(tmpdir(), userInfo().username)
  setCustom("backup-directory-alist", [[".", userTemporaryFileDirectory]])

  installGruvboxDarkHardTheme(editor)
  enableBuiltinTheme(gruvboxDarkHardTheme.name)
  setFaceAttribute("default", "family", "Fira Code")
  setFaceAttribute("default", "height", 140)
  editor.setTheme(gruvboxDarkHardTheme)
  installVertico(editor)
  installWindow(editor)
  installTiling(editor)
  editor.enableMinorMode("linum-mode")
  editor.enableMinorMode("vertico-mode")

  bindStephenKeys(editor)
  installStephenCommands(editor)
}

function bindStephenKeys(editor: Editor): void {
  editor.key("C-c t", "lsp-find-definition")
  editor.key("C-c C-t", "lsp-ui-peek-find-implementation")
  editor.key("C-x C-a", "lsp-execute-code-action")
  editor.key("s-f", "counsel-ag")
  editor.key("s-=", "text-scale-adjust")
}

function installStephenCommands(editor: Editor): void {
}
