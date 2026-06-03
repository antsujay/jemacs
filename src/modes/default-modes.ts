import { defineMode } from "./mode"
import { installDiredMode } from "./dired"
import { installPythonMode } from "./python"

export function installDefaultModes(): void {
  defineMode({ name: "text" })
  defineMode({ name: "prog-mode", parent: "text" })
  defineMode({ name: "markdown", parent: "text" })
  defineMode({ name: "json", parent: "text" })
  defineMode({ name: "javascript", parent: "prog-mode", commentStart: "//" })
  defineMode({ name: "typescript", parent: "prog-mode", commentStart: "//" })
  installPythonMode()
  installDiredMode()
}
