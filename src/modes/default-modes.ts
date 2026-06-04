import { defineMode } from "./mode"
import { installDiredMode } from "./dired"
import { installPythonMode } from "./python"
import { installConfigModes } from "./generic"

export function installDefaultModes(): void {
  defineMode({ name: "text" })
  defineMode({ name: "prog-mode", parent: "text" })
  defineMode({ name: "markdown", parent: "text" })
  defineMode({ name: "json", parent: "text" })
  installConfigModes()
  installPythonMode()
  installDiredMode()
}
