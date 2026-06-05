import type { Editor } from "../../src/kernel/editor"
import { createPluginContext, type PluginContext } from "../../src/runtime/plugin-context"

export function install(editor: Editor, ctx: PluginContext = createPluginContext(editor)): void {
  editor.startAutoSave()
  ctx.onDispose(() => editor.stopAutoSave())

  editor.command("recover-this-file", async ({ editor: ed }) => {
    await ed.recoverThisFile()
  }, "Replace buffer text from its #file# auto-save data if newer than the visited file.")

  editor.command("do-auto-save", async ({ editor: ed }) => {
    const n = await ed.doAutoSave()
    ed.message(n ? `Auto-saved ${n} buffer${n === 1 ? "" : "s"}` : "(No buffers need auto-saving)")
  }, "Auto-save all dirty file-visiting buffers now.")

  ctx.hook("after-save-hook", async ({ editor: ed, buffer }) => {
    await ed.deleteAutoSaveFile(buffer)
  })
}
