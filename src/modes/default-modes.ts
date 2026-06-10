import { defineMode } from "./mode"
import { installBufferListMode } from "./buffer-list"
import { installCustomizeMode } from "./customize"
import { installDiredMode } from "./dired"
import { installLinumMode } from "./linum-mode"
import { installHelpMode } from "./help"
import { installMinibufferMode } from "./minibuffer"
import { installPythonMode } from "./python"
import { installShellScriptMode } from "./shell-script"
import { installConfigModes } from "./generic"
import { installEmacsLispMode } from "./emacs-lisp"

export function installDefaultModes(): void {
  installLinumMode()
  defineMode({ name: "text" })
  installMinibufferMode()
  installHelpMode()
  installCustomizeMode()
  defineMode({ name: "prog-mode", parent: "text" })
  installConfigModes()
  installEmacsLispMode()
  installPythonMode()
  installShellScriptMode()
  installBufferListMode()
  installDiredMode()
}
