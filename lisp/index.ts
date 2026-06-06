import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Editor } from "../src/kernel/editor"
import { Evaluator } from "../src/runtime/evaluator"
import { installLiveSourceCommands } from "../src/runtime/live-source"
import * as simple from "./simple"
import * as windowCmds from "./window-cmds"
import * as files from "./files"
import * as isearchUi from "./isearch-ui"
import * as minibuf from "./minibuf"
import * as misc from "./misc"

const HERE = dirname(fileURLToPath(import.meta.url))
const path = (name: string) => join(HERE, `${name}.ts`)

/** Install every built-in command group. Replaces the old monolithic
 *  installCoreCommands / installEmacsStandardCommands pair. Each module is
 *  routed through evaluator.installPlugin so the tracked-ctx / dispose policy
 *  lives in exactly one place (and a later loadPlugin on the same path
 *  disposes the boot-time install). */
export function installLisp(editor: Editor, evaluator: Evaluator = new Evaluator(editor)): Evaluator {
  void evaluator.installPlugin(path("simple"), simple.install)
  void evaluator.installPlugin(path("window-cmds"), windowCmds.install)
  void evaluator.installPlugin(path("files"), files.install)
  void evaluator.installPlugin(path("isearch-ui"), isearchUi.install)
  void evaluator.installPlugin(path("minibuf"), minibuf.install)
  void evaluator.installPlugin(path("misc"), (e, ctx) => misc.install(e, ctx, evaluator))
  installLiveSourceCommands(editor, evaluator)
  return evaluator
}

export { readKey } from "./misc"
export { substituteInFileName } from "./files"
