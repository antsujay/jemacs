/// <reference lib="dom" />
import type { SerializedDisplayModel, SerializedPane, SerializedWindowNode } from "../display/serialize"
import { renderCaret } from "../display/dom-frame"

declare global {
  interface Window {
    __JEMACS_TOKEN__?: string
  }
}

type DisplayHandler = (model: SerializedDisplayModel) => void
type TerminalDataHandler = (payload: unknown) => void
type Cursor = { row: number; colOffset: number }
type Motion = "left" | "right" | "up" | "down" | "home" | "end"
type KeyPayload = { type: "key"; key: { name: string; ctrl?: boolean; meta?: boolean; shift?: boolean; super?: boolean } }

const token = window.__JEMACS_TOKEN__
const ws = new WebSocket(`ws://${location.host}/ws`)
let displayHandler: DisplayHandler | null = null
let terminalDataHandler: TerminalDataHandler | null = null
const pending: SerializedDisplayModel[] = []

/** Optimistic-caret state captured after each authoritative display so motion
 *  keys can repaint the caret immediately, before the server round-trip. */
let lastModel: SerializedDisplayModel | null = null
let lastCursor: Cursor | null = null
let lastBody: HTMLElement | null = null
let lastRows: HTMLElement[] = []
let lastFg: string | undefined

function selectedPane(node: SerializedWindowNode): SerializedPane | null {
  if (node.kind === "leaf") return node.pane.selected ? node.pane : null
  return selectedPane(node.first) ?? selectedPane(node.second)
}

function captureCaretState(model: SerializedDisplayModel): void {
  lastModel = model
  const pane = selectedPane(model.windows)
  lastCursor = pane?.cursor ? { ...pane.cursor } : null
  lastFg = model.theme.faces.default?.fg
  lastBody = document.querySelector<HTMLElement>(".window-pane.selected .window-body")
  lastRows = lastBody ? [...lastBody.querySelectorAll<HTMLElement>(".body-row")] : []
}

function minibufferActive(model: SerializedDisplayModel): boolean {
  return model.minibuffer.chunks.some(c => c.text.trim().length > 0)
}

function classifyMotion(key: KeyPayload["key"]): Motion | null {
  if (key.meta || key.shift || key.super) return null
  const bare = !key.ctrl
  if (bare) {
    if (key.name === "left") return "left"
    if (key.name === "right") return "right"
    if (key.name === "up") return "up"
    if (key.name === "down") return "down"
    if (key.name === "home") return "home"
    if (key.name === "end") return "end"
    return null
  }
  if (key.name === "b") return "left"
  if (key.name === "f") return "right"
  if (key.name === "p") return "up"
  if (key.name === "n") return "down"
  if (key.name === "a") return "home"
  if (key.name === "e") return "end"
  return null
}

function rowLen(i: number): number {
  return lastRows[i]?.textContent?.length ?? 0
}

function predict(cursor: Cursor, motion: Motion): Cursor {
  let { row, colOffset } = cursor
  const maxRow = Math.max(0, lastRows.length - 1)
  switch (motion) {
    case "left":
      if (colOffset > 0) colOffset--
      else if (row > 0) { row--; colOffset = rowLen(row) }
      break
    case "right":
      if (colOffset < rowLen(row)) colOffset++
      else if (row < maxRow) { row++; colOffset = 0 }
      break
    case "up":
      if (row > 0) row--
      colOffset = Math.min(colOffset, rowLen(row))
      break
    case "down":
      if (row < maxRow) row++
      colOffset = Math.min(colOffset, rowLen(row))
      break
    case "home":
      colOffset = 0
      break
    case "end":
      colOffset = rowLen(row)
      break
  }
  return { row, colOffset }
}

function applyOptimisticCaret(payload: unknown): void {
  if (!lastModel || !lastCursor || !lastBody || !lastRows.length) return
  if (minibufferActive(lastModel)) return
  const p = payload as Partial<KeyPayload> | null
  if (!p || p.type !== "key" || !p.key) return
  const motion = classifyMotion(p.key)
  if (!motion) return
  const predicted = predict(lastCursor, motion)
  for (const old of lastBody.querySelectorAll(".jemacs-caret")) old.remove()
  renderCaret(lastBody, lastRows, predicted, lastFg, "predicted")
  lastCursor = predicted
}

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "auth", token }))
}
ws.onmessage = event => {
  const model = JSON.parse(String(event.data)) as SerializedDisplayModel
  if (displayHandler) {
    displayHandler(model)
    captureCaretState(model)
  } else pending.push(model)
}
ws.onclose = () => {
  document.title = "Jemacs (disconnected)"
}

// Same surface as the Electron preload so `renderer.ts` is unchanged.
window.jemacs = {
  onDisplay(handler: DisplayHandler): () => void {
    displayHandler = handler
    for (const m of pending.splice(0)) {
      handler(m)
      captureCaretState(m)
    }
    return () => { if (displayHandler === handler) displayHandler = null }
  },
  onTerminalData(handler: TerminalDataHandler): () => void {
    terminalDataHandler = handler
    return () => { if (terminalDataHandler === handler) terminalDataHandler = null }
  },
  sendInput(payload: unknown): void {
    applyOptimisticCaret(payload)
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  },
  ready(): void { /* no-op: server pushes on auth */ },
}

// `renderer.ts` reads `window.jemacs` at module-eval time. Static `import` is
// hoisted above this body, so use a dynamic import to guarantee ordering.
void import("../electron/renderer")
