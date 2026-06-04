import { defineMode } from "./mode"
import { installDiredMode } from "./dired"
import { installLinumMode } from "./linum-mode"
import { installMinibufferMode } from "./minibuffer"
import { installPythonMode } from "./python"
import { installConfigModes } from "./generic"

export function installDefaultModes(): void {
  installLinumMode()
  defineMode({ name: "text" })
  installMinibufferMode()
  defineMode({ name: "prog-mode", parent: "text" })
  defineMode({ name: "markdown", parent: "text" })
  defineMode({ name: "json", parent: "text" })
  installConfigModes()
  installPythonMode()
  installDiredMode()
}
