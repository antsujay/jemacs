import type { Editor } from "../kernel/editor"
import { setTransientMarkModeEnabled } from "../kernel/transient-mark"
import { defcustom, getCustom, setCustom } from "../runtime/custom"

export function installDefaultCustomVariables(editor: Editor): void {
  defcustom("transient-mark-mode", "boolean", true, "When non-nil, movement deactivates the mark (region highlight remains).")
  setTransientMarkModeEnabled(getCustom<boolean>("transient-mark-mode") ?? true)

  editor.command("toggle-transient-mark-mode", () => {
    const next = !(getCustom<boolean>("transient-mark-mode") ?? true)
    setCustom("transient-mark-mode", next)
    setTransientMarkModeEnabled(next)
    editor.message(`Transient Mark mode ${next ? "on" : "off"}`)
  }, "Toggle `transient-mark-mode`.")
}
