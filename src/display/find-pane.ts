import type { WindowDisplayNode, WindowPaneModel } from "./protocol"

export function findPaneInModel(windows: WindowDisplayNode, windowId: string): WindowPaneModel | null {
  if (windows.kind === "leaf") {
    return windows.pane.id === windowId ? windows.pane : null
  }
  return findPaneInModel(windows.first, windowId) ?? findPaneInModel(windows.second, windowId)
}
