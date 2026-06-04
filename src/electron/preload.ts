import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("jemacs", {
  onDisplay(handler: (model: unknown) => void): () => void {
    const listener = (_event: unknown, model: unknown) => handler(model)
    ipcRenderer.on("jemacs:display", listener)
    return () => ipcRenderer.removeListener("jemacs:display", listener)
  },
  sendInput(payload: unknown): void {
    ipcRenderer.send("jemacs:input", payload)
  },
  ready(): void {
    ipcRenderer.send("jemacs:ready")
  },
})
