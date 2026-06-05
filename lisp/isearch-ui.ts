import type { Editor } from "../src/kernel/editor"
import { createPluginContext, type PluginContext } from "../src/runtime/plugin-context"

export function install(editor: Editor, ctx: PluginContext = createPluginContext(editor)): void {
  editor.command("isearch-forward", ({ editor }) => {
    if (editor.isearch?.direction === 1) editor.isearchRepeat()
    else editor.startIsearch(1)
  }, "Incremental search forward.")

  editor.command("isearch-backward", ({ editor }) => {
    if (editor.isearch?.direction === -1) editor.isearchRepeat()
    else editor.startIsearch(-1)
  }, "Incremental search backward.")

  editor.key("C-s", "isearch-forward")
  editor.key("C-r", "isearch-backward")
}
