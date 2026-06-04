import type { Editor } from "../kernel/editor"
import type { Evaluator } from "../runtime/evaluator"
import { installCoreCommands } from "../core/commands"
import { bindDefaultKeybindings } from "./default-bindings"

/** Load built-in commands and default keybindings (same mechanism as user config). */
export function installDefaultConfig(editor: Editor): Evaluator {
  const evaluator = installCoreCommands(editor)
  bindDefaultKeybindings(editor)
  return evaluator
}

/** @deprecated Use `installDefaultConfig`; kept for reload hooks and older plugins. */
export function installDefaultCommands(editor: Editor): Evaluator {
  return installDefaultConfig(editor)
}
