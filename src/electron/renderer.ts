import type { SerializedDisplayModel } from "../display/serialize"
import { presentDomFrame } from "../display/dom-frame"

const titleEl = document.getElementById("jemacs-title")!
const windowsEl = document.getElementById("jemacs-windows")!
const minibufferEl = document.getElementById("jemacs-minibuffer")!
const echoEl = document.getElementById("jemacs-echo")!

declare global {
  interface Window {
    jemacs: {
      onDisplay(handler: (model: SerializedDisplayModel) => void): () => void
      sendInput(payload: unknown): void
      ready(): void
    }
  }
}

function present(model: SerializedDisplayModel): void {
  presentDomFrame(
    { title: titleEl, windows: windowsEl, minibuffer: minibufferEl, echo: echoEl },
    model,
    (windowId, row, col) => {
      window.jemacs.sendInput({ type: "mouse", windowId, row, col, button: 0 })
    },
  )
}

function keyName(event: KeyboardEvent): string {
  if (event.key === "Enter") return "return"
  if (event.key === "Escape") return "escape"
  if (event.key === "Tab") return "tab"
  if (event.key === "Backspace") return "backspace"
  if (event.key === " ") return "space"
  if (event.key.length === 1) return event.key.toLowerCase()
  return event.key.toLowerCase()
}

document.addEventListener("keydown", event => {
  if (event.defaultPrevented) return
  const name = keyName(event)
  if (event.metaKey && name.length === 1) {
    event.preventDefault()
    return
  }
  window.jemacs.sendInput({
    type: "key",
    key: {
      name,
      sequence: event.key,
      raw: event.key,
      ctrl: event.ctrlKey,
      meta: event.metaKey || event.altKey,
      shift: event.shiftKey,
    },
  })
  if (name.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) event.preventDefault()
})

document.addEventListener("paste", event => {
  const text = event.clipboardData?.getData("text")
  if (!text) return
  event.preventDefault()
  window.jemacs.sendInput({ type: "paste", text })
})

try {
  window.jemacs.onDisplay(present)
  window.jemacs.ready()
} catch (error) {
  console.error("Jemacs renderer failed to start:", error)
  document.body.textContent = `Renderer error: ${error instanceof Error ? error.message : String(error)}`
}
