import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Editor } from "../src/kernel/editor"
import { Evaluator } from "../src/runtime/evaluator"
import { trackedContext } from "../src/runtime/plugin-context"
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
 *  installCoreCommands / installEmacsStandardCommands pair. Each module gets
 *  a tracked PluginContext keyed by its source path so a later
 *  evaluator.loadPlugin on the same file disposes the boot-time install. */
export function installLisp(editor: Editor): Evaluator {
  const evaluator = new Evaluator(editor)
  simple.install(editor, trackedContext(editor, path("simple")))
  windowCmds.install(editor, trackedContext(editor, path("window-cmds")))
  files.install(editor, trackedContext(editor, path("files")))
  isearchUi.install(editor, trackedContext(editor, path("isearch-ui")))
  minibuf.install(editor, trackedContext(editor, path("minibuf")))
  misc.install(editor, trackedContext(editor, path("misc")), evaluator)
  installLiveSourceCommands(editor, evaluator)
  return evaluator
}

export { readKey } from "./misc"
export { substituteInFileName } from "./files"
