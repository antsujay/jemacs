/// <reference lib="dom" />
import type { SerializedDisplayModel, SerializedThemedText, SerializedWindowNode } from "./serialize"

export type SerializedChunk = SerializedThemedText["chunks"][number]

export const DOM_FRAME_ROW_PX = 18
export const DOM_FRAME_COL_PX = 9

export function renderChunk(parent: HTMLElement, chunk: SerializedChunk): void {
  const span = document.createElement("span")
  span.textContent = chunk.text
  if (chunk.fg) span.style.color = chunk.fg
  if (chunk.bg) span.style.backgroundColor = chunk.bg
  if (chunk.bold) span.style.fontWeight = "bold"
  if (chunk.italic) span.style.fontStyle = "italic"
  if (chunk.underline) span.style.textDecoration = "underline"
  parent.appendChild(span)
}

export function renderThemedText(el: HTMLElement, model: SerializedThemedText): void {
  el.replaceChildren()
  for (const chunk of model.chunks) renderChunk(el, chunk)
}

export type DomFrameMouseHandler = (windowId: string, row: number, col: number) => void

export function renderWindows(
  node: SerializedWindowNode,
  onMouse?: DomFrameMouseHandler,
): HTMLElement {
  if (node.kind === "leaf") {
    const pane = document.createElement("div")
    pane.className = `window-pane${node.pane.selected ? " selected" : ""}`
    pane.dataset.windowId = node.pane.id
    const sendMouse = (event: MouseEvent, target: HTMLElement) => {
      if (event.button !== 0 || !onMouse) return
      const rect = target.getBoundingClientRect()
      const row = Math.max(0, Math.floor((event.clientY - rect.top) / DOM_FRAME_ROW_PX))
      const col = Math.max(0, Math.floor((event.clientX - rect.left) / DOM_FRAME_COL_PX))
      onMouse(node.pane.id, row, col)
    }
    const body = document.createElement("div")
    body.className = "window-body"
    renderThemedText(body, node.pane.body)
    body.addEventListener("mousedown", event => sendMouse(event, body))
    pane.addEventListener("mousedown", event => {
      if (event.target === pane) sendMouse(event, body)
    })
    const modeline = document.createElement("div")
    modeline.className = "window-modeline"
    renderThemedText(modeline, node.pane.modeline)
    pane.append(body, modeline)
    return pane
  }
  const split = document.createElement("div")
  split.className = node.direction === "vertical" ? "split-col" : "split-row"
  split.append(renderWindows(node.first, onMouse), renderWindows(node.second, onMouse))
  return split
}

export type DomFrameTargets = {
  title: HTMLElement
  windows: HTMLElement
  minibufferCompletions?: HTMLElement
  minibuffer: HTMLElement
  echo: HTMLElement
}

export function presentDomFrame(
  targets: DomFrameTargets,
  model: SerializedDisplayModel,
  onMouse?: DomFrameMouseHandler,
): void {
  renderThemedText(targets.title, model.title)
  targets.windows.replaceChildren(renderWindows(model.windows, onMouse))
  if (targets.minibufferCompletions) {
    renderThemedText(targets.minibufferCompletions, model.minibufferCompletions)
    targets.minibufferCompletions.style.display = model.minibufferCompletionLines > 0 ? "" : "none"
  }
  renderThemedText(targets.minibuffer, model.minibuffer)
  renderThemedText(targets.echo, model.echo)
  const bg = model.theme.faces.default?.bg
  if (bg) document.body.style.backgroundColor = bg
}
