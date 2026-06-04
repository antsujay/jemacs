/** When true, movement deactivates the mark while keeping the region highlight (Emacs transient-mark-mode). */
let transientMarkModeEnabled = true

export function isTransientMarkModeEnabled(): boolean {
  return transientMarkModeEnabled
}

export function setTransientMarkModeEnabled(enabled: boolean): void {
  transientMarkModeEnabled = enabled
}
