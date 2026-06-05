import { defineMode } from "./mode"
import { installBufferListMode } from "./buffer-list"
import { installDiredMode } from "./dired"
import { installIvyMode } from "./ivy-mode"
import { installLinumMode } from "./linum-mode"
import { installHelpMode } from "./help"
import { installMinibufferMode } from "./minibuffer"
import { installPythonMode } from "./python"
import { installConfigModes } from "./generic"

export function installDefaultModes(): void {
  installLinumMode()
  installIvyMode()
  defineMode({ name: "text" })
  installMinibufferMode()
  installHelpMode()
  defineMode({ name: "prog-mode", parent: "text" })
  installConfigModes()
  installPythonMode()
  installBufferListMode()
  installDiredMode()
}
