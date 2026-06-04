import type { Editor } from "../kernel/editor"
import { runJemacs } from "../run"
import { OpenTuiHost } from "./opentui-host"

/** @deprecated Use runJemacs(editor, new OpenTuiHost()) */
export async function startOpenTui(editor: Editor): Promise<void> {
  await runJemacs(editor, new OpenTuiHost())
}
