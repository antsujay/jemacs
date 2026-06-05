import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import type { Editor } from "../kernel/editor"
import type { Evaluator } from "../runtime/evaluator"
import { addToLoadPath } from "../runtime/load-path"
import { installCoreCommands } from "../core/commands"
import { installLinumMode } from "../modes/linum-mode"
import { installTextScaleMode } from "../core/text-scale"
import { installMinorModeCommands } from "../modes/minor-mode"
import { installCustomizeCommands } from "../modes/customize"
import { bindDefaultKeybindings } from "./default-bindings"
import { installUserConfig } from "./user"
import { installStephenConfig } from "./stephen"
import { installDefaultCustomVariables } from "./custom-init"
import { installDefaultFaces } from "./faces-init"
import { install as installWindowPlugin } from "../../plugins/window"

export { installDefaultHooks, installLspDeferredHooks } from "./install-hooks"
export { LSP_AUTO_MODES, LSP_AUTO_EXTENSIONS, shouldAutoStartLsp } from "./lsp-auto-modes"

export type DefaultConfigOptions = {
  installStephen?: boolean
}

/** Load built-in commands and default keybindings (same mechanism as user config). */
export function installDefaultConfig(editor: Editor, options: DefaultConfigOptions = {}): Evaluator {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..")
  addToLoadPath(root)
  addToLoadPath(join(homedir(), ".jemacs"))
  const evaluator = installCoreCommands(editor)
  installLinumMode()
  installTextScaleMode()
  installMinorModeCommands(editor)
  installCustomizeCommands(editor)
  installWindowPlugin(editor)
  bindDefaultKeybindings(editor)
  installDefaultCustomVariables(editor)
  installDefaultFaces()
  if (options.installStephen ?? false) installStephenConfig(editor)
  installUserConfig(editor)
  return evaluator
}

export { loadCustomFile, saveCustomFile, customFilePath } from "./load-custom"

export { installUserConfig } from "./user"
export { installStephenConfig } from "./stephen"
