import type { Editor } from "../kernel/editor"
import { setTransientMarkModeEnabled } from "../kernel/transient-mark"
import { defcustom, getCustom, setCustom } from "../runtime/custom"

export function installDefaultCustomVariables(editor: Editor): void {
  defcustom("transient-mark-mode", "boolean", true, "When non-nil, movement deactivates the mark (region highlight remains).")
  setTransientMarkModeEnabled(getCustom<boolean>("transient-mark-mode") ?? true)

  const setTransientMarkMode = (enabled: boolean): void => {
    setCustom("transient-mark-mode", enabled)
    setTransientMarkModeEnabled(enabled)
    editor.message(`Transient Mark mode ${enabled ? "on" : "off"}`)
  }

  editor.command("transient-mark-mode", ({ prefixArgument }) => {
    const next = prefixArgument == null
      ? !(getCustom<boolean>("transient-mark-mode") ?? true)
      : prefixArgument > 0
    setTransientMarkMode(next)
  }, "Toggle Transient Mark mode interactively.")

  editor.command("jemacs-toggle-transient-mark-mode", () => {
    const next = !(getCustom<boolean>("transient-mark-mode") ?? true)
    setTransientMarkMode(next)
  }, "Jemacs extension alias for transient-mark-mode toggle.")
}
