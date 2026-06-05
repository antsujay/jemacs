import type { Editor } from "../src/kernel/editor"
import type { Evaluator } from "../src/runtime/evaluator"
import { installLiveSourceCommands } from "../src/runtime/live-source"
import * as simple from "./simple"
import * as windowCmds from "./window-cmds"
import * as files from "./files"
import * as isearchUi from "./isearch-ui"
import * as minibuf from "./minibuf"
import * as misc from "./misc"

/** Install every built-in command group. Replaces the old monolithic
 *  installCoreCommands / installEmacsStandardCommands pair. */
export function installLisp(editor: Editor): Evaluator {
  simple.install(editor)
  windowCmds.install(editor)
  files.install(editor)
  isearchUi.install(editor)
  minibuf.install(editor)
  const evaluator = misc.install(editor)
  installLiveSourceCommands(editor, evaluator)
  return evaluator
}

export { readKey } from "./misc"
export { substituteInFileName } from "./files"
