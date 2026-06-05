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
  grow = 1,
  theme?: SerializedDisplayModel["theme"],
): HTMLElement {
  if (node.kind === "leaf") {
    const pane = document.createElement("div")
    pane.className = `window-pane${node.pane.selected ? " selected" : ""}`
    pane.dataset.windowId = node.pane.id
    pane.style.flexGrow = String(Math.max(0.05, grow))
    const defaultFace = themeFace(theme, "default")
    const modelineFace = themeFace(theme, node.pane.selected ? "modeLine" : "modeLineInactive")
    if (defaultFace?.bg) pane.style.backgroundColor = defaultFace.bg
    if (modelineFace?.bg) pane.style.borderColor = modelineFace.bg
    const sendMouse = (event: MouseEvent, target: HTMLElement) => {
      if (event.button !== 0 || !onMouse) return
      const rect = target.getBoundingClientRect()
      const row = Math.max(0, Math.floor((event.clientY - rect.top) / DOM_FRAME_ROW_PX))
      const col = Math.max(0, Math.floor((event.clientX - rect.left) / DOM_FRAME_COL_PX))
      onMouse(node.pane.id, row, col)
    }
    const body = document.createElement("div")
    body.className = "window-body"
    if (defaultFace?.bg) body.style.backgroundColor = defaultFace.bg
    renderThemedText(body, node.pane.body)
    body.addEventListener("mousedown", event => sendMouse(event, body))
    pane.addEventListener("mousedown", event => {
      if (event.target === pane) sendMouse(event, body)
    })
    const modeline = document.createElement("div")
    modeline.className = "window-modeline"
    if (modelineFace?.bg) modeline.style.backgroundColor = modelineFace.bg
    if (modelineFace?.fg) modeline.style.color = modelineFace.fg
    renderThemedText(modeline, node.pane.modeline)
    pane.append(body, modeline)
    return pane
  }
  const split = document.createElement("div")
  split.className = node.direction === "vertical" ? "split-col" : "split-row"
  split.style.flexGrow = String(Math.max(0.05, grow))
  const firstRatio = node.firstRatio ?? 0.5
  split.append(renderWindows(node.first, onMouse, firstRatio, theme), renderWindows(node.second, onMouse, 1 - firstRatio, theme))
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
  applyThemeSurfaces(targets, model)
  renderThemedText(targets.title, model.title)
  targets.windows.replaceChildren(renderWindows(model.windows, onMouse, 1, model.theme))
  if (targets.minibufferCompletions) {
    renderThemedText(targets.minibufferCompletions, model.minibufferCompletions)
    targets.minibufferCompletions.style.display = model.minibufferCompletionLines > 0 ? "" : "none"
  }
  renderThemedText(targets.minibuffer, model.minibuffer)
  renderThemedText(targets.echo, model.echo)
}

function applyThemeSurfaces(targets: DomFrameTargets, model: SerializedDisplayModel): void {
  const defaultFace = model.theme.faces.default
  const titleFace = model.theme.faces.title ?? defaultFace
  const minibufferFace = model.theme.faces.minibuffer ?? defaultFace
  const bg = defaultFace?.bg
  const fg = defaultFace?.fg
  const root = document.getElementById("jemacs-root")
  for (const el of [document.documentElement, document.body, root, targets.windows]) {
    if (!el) continue
    if (bg) el.style.backgroundColor = bg
    if (fg) el.style.color = fg
  }
  applyFace(targets.title, titleFace)
  if (targets.minibufferCompletions) applyFace(targets.minibufferCompletions, minibufferFace)
  applyFace(targets.minibuffer, minibufferFace)
  applyFace(targets.echo, minibufferFace)
}

function applyFace(el: HTMLElement, face: { fg?: string; bg?: string } | undefined): void {
  if (face?.bg) el.style.backgroundColor = face.bg
  if (face?.fg) el.style.color = face.fg
}

function themeFace(theme: SerializedDisplayModel["theme"] | undefined, face: string): { fg?: string; bg?: string } | undefined {
  if (!theme) return undefined
  return (theme.faces as Record<string, { fg?: string; bg?: string } | undefined>)[face] ?? theme.faces.default
}
