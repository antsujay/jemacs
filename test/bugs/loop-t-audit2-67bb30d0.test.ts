/**
 * t-audit2-67bb30d0: `presentDomFrame` did `targets.windows.replaceChildren(
 * renderWindows(...))` unconditionally — every keystroke rebuilt the whole
 * window tree. For a terminal pane that's `rows×cols` createElement+appendChild
 * per frame. Fix: memoise the previous model on the windows container, compare
 * tree shape + per-pane fields, and patch only what changed (cell-level for
 * same-shape terminal grids).
 *
 * t-audit2-d6617590 (merged, p2): `renderCaret` queued `requestAnimationFrame
 * (place)` and never cancelled it; after the next present() the closure ran
 * against detached `body`/`rowEl`. Fix: track pending rAF ids and cancel them
 * at the top of `presentDomFrame`; `place()` also bails when `!body.isConnected`.
 *
 * Both landed alongside t-audit2-18e7a2c9; this file pins the diff path's
 * fine-grained branches (modeline-only, terminal cursor-only) and the rAF
 * bookkeeping for direct `renderCaret` callers.
 */
import { afterEach, expect, test } from "bun:test"
import type { SerializedDisplayModel, SerializedPane } from "../../src/display/serialize"
import type { TerminalSurfaceModel } from "../../src/display/terminal-surface"

// ── Minimal DOM fake ────────────────────────────────────────────────────────

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
const rect = (l: number, t: number, w: number, h: number): Rect =>
  ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h })

let createCount = 0
class FakeText { nodeType = 3; constructor(public data: string) {} }
class FakeEl {
  nodeType = 1
  children: FakeEl[] = []
  childNodes: Array<FakeEl | FakeText> = []
  classList = { _s: new Set<string>(), add: (c: string) => { this.classList._s.add(c) },
    remove: (c: string) => { this.classList._s.delete(c) }, has: (c: string) => this.classList._s.has(c) }
  dataset: Record<string, string> = {}
  style: Record<string, string> & { setProperty(k: string, v: string): void }
  isConnected = false
  parentNode: FakeEl | null = null
  scrollLeft = 0; scrollTop = 0
  _listeners: Record<string, Array<(ev: unknown) => void>> = {}
  constructor(public tagName: string) {
    this.style = Object.assign({ setProperty: (k: string, v: string) => { this.style[k] = v } })
  }
  set className(v: string) { this.classList._s = new Set(v.split(/\s+/).filter(Boolean)) }
  get className() { return [...this.classList._s].join(" ") }
  set textContent(v: string) { this.childNodes = [new FakeText(v)]; this.children = [] }
  get textContent(): string {
    return this.childNodes.map(n => n instanceof FakeText ? n.data : (n as FakeEl).textContent).join("")
  }
  appendChild<T extends FakeEl | FakeText>(c: T): T {
    this.childNodes.push(c)
    if (c instanceof FakeEl) { this.children.push(c); c.parentNode = this; c._connect(this.isConnected) }
    return c
  }
  append(...cs: FakeEl[]) { for (const c of cs) this.appendChild(c) }
  replaceChildren(...cs: FakeEl[]) {
    for (const old of this.children) old._connect(false)
    this.children = []; this.childNodes = []
    for (const c of cs) this.appendChild(c)
  }
  remove() {
    const p = this.parentNode
    if (p) { p.children.splice(p.children.indexOf(this), 1); p.childNodes.splice(p.childNodes.indexOf(this), 1) }
    this._connect(false)
  }
  _connect(v: boolean) { this.isConnected = v; for (const c of this.children) c._connect(v) }
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.replace(/^\./, "")
    const out: FakeEl[] = []
    const walk = (el: FakeEl) => { if (el.classList.has(cls)) out.push(el); for (const c of el.children) walk(c) }
    for (const c of this.children) walk(c)
    return out
  }
  addEventListener(ev: string, fn: (e: unknown) => void) { (this._listeners[ev] ??= []).push(fn) }
  getBoundingClientRect() { return rect(0, 0, 0, 0) }
  scrollIntoView() {}
}

let rafQueue: Array<{ id: number; fn: () => void }> = []
let cancelled = new Set<number>()
let nextRaf = 1
const saved: Record<string, unknown> = {}
const stub = (k: string, v: unknown) => {
  if (!(k in saved)) saved[k] = (globalThis as Record<string, unknown>)[k]
  ;(globalThis as Record<string, unknown>)[k] = v
}
function installDom() {
  createCount = 0; rafQueue = []; cancelled = new Set(); nextRaf = 1
  const html = new FakeEl("html"); html._connect(true)
  const body = new FakeEl("body"); body._connect(true)
  stub("document", {
    documentElement: html, body,
    getElementById: () => null,
    createElement: (t: string) => { createCount++; return new FakeEl(t) },
    createRange: undefined,
    createTreeWalker: () => ({ nextNode: () => null }),
  })
  stub("requestAnimationFrame", (fn: () => void) => { const id = nextRaf++; rafQueue.push({ id, fn }); return id })
  stub("cancelAnimationFrame", (id: number) => { cancelled.add(id); rafQueue = rafQueue.filter(r => r.id !== id) })
}
afterEach(() => { for (const [k, v] of Object.entries(saved)) (globalThis as Record<string, unknown>)[k] = v })

// ── fixtures ────────────────────────────────────────────────────────────────

const themed = (text: string) => ({ chunks: [{ text }] })
function basePane(over: Partial<SerializedPane> = {}): SerializedPane {
  return {
    id: "w1", bufferId: "b1", selected: true, dedicated: false,
    body: themed("a\nb\nc"), modeline: themed(" -:-- buf "),
    clickState: { startLine: 0, gutterPrefixLen: 0 },
    bodyLineBudget: 24, syncText: "", syncPoint: 0, textScale: 1,
    ...over,
  }
}
function model(pane: SerializedPane): SerializedDisplayModel {
  return {
    title: themed("jemacs"), windows: { kind: "leaf", pane }, childFrames: [],
    minibufferCompletions: themed(""), minibufferCompletionLines: 0,
    minibuffer: themed(""), echo: themed(""),
    theme: { faces: { default: { fg: "#ddd", bg: "#111" } } } as never,
    viewport: { rows: 24, cols: 80 }, hostLabel: "test",
  }
}
function targets() {
  const mk = () => { const e = new FakeEl("div"); e._connect(true); return e }
  return { title: mk(), windows: mk(), minibuffer: mk(), echo: mk(), minibufferCompletions: mk() }
}
const grid = (rows: number, cols: number, ch: string): TerminalSurfaceModel => ({
  kind: "terminal", rows, cols, cursorRow: 0, cursorCol: 0,
  cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ text: ch }))),
})

// ── t-audit2-67bb30d0: diff path ────────────────────────────────────────────

test("identical model re-present creates zero elements and keeps pane DOM", async () => {
  installDom()
  const { presentDomFrame } = await import("../../src/display/dom-frame")
  const t = targets()
  presentDomFrame(t as never, model(basePane({ cursor: { row: 0, colOffset: 0 } })))
  const paneEl = t.windows.querySelectorAll("window-pane")[0]!
  const bodyEl = t.windows.querySelectorAll("window-body")[0]!
  const modelineEl = t.windows.querySelectorAll("window-modeline")[0]!
  expect(createCount).toBeGreaterThan(0)

  createCount = 0
  presentDomFrame(t as never, model(basePane({ cursor: { row: 0, colOffset: 0 } })))
  expect(createCount).toBe(0)
  expect(t.windows.querySelectorAll("window-pane")[0]).toBe(paneEl)
  expect(t.windows.querySelectorAll("window-body")[0]).toBe(bodyEl)
  expect(t.windows.querySelectorAll("window-modeline")[0]).toBe(modelineEl)
})

test("modeline-only change leaves body subtree untouched", async () => {
  installDom()
  const { presentDomFrame } = await import("../../src/display/dom-frame")
  const t = targets()
  presentDomFrame(t as never, model(basePane()))
  const bodyEl = t.windows.querySelectorAll("window-body")[0]!
  const bodySpan = bodyEl.children[0]

  createCount = 0
  presentDomFrame(t as never, model(basePane({ modeline: themed(" -:** buf ") })))
  // Only the modeline span(s) are rebuilt — body element and its children survive.
  expect(t.windows.querySelectorAll("window-body")[0]).toBe(bodyEl)
  expect(bodyEl.children[0]).toBe(bodySpan)
  expect(createCount).toBeLessThanOrEqual(2)
})

test("terminal cursor move patches two cells, not rows×cols", async () => {
  installDom()
  const { presentDomFrame } = await import("../../src/display/dom-frame")
  const t = targets()
  presentDomFrame(t as never, model(basePane({ terminalSurface: grid(8, 20, ".") })))
  const full = createCount // ~ 8 rows + 160 cells + chrome

  createCount = 0
  const moved = grid(8, 20, "."); moved.cursorRow = 3; moved.cursorCol = 7
  presentDomFrame(t as never, model(basePane({ terminalSurface: moved })))
  // patchTerminalSurface mutates spans in place — no createElement at all.
  expect(createCount).toBe(0)
  expect(full).toBeGreaterThan(160)
})

test("shape change (split) falls back to full rebuild", async () => {
  installDom()
  const { presentDomFrame } = await import("../../src/display/dom-frame")
  const t = targets()
  presentDomFrame(t as never, model(basePane()))
  createCount = 0
  const split: SerializedDisplayModel = {
    ...model(basePane()),
    windows: {
      kind: "split", direction: "vertical", firstRatio: 0.5,
      first: { kind: "leaf", pane: basePane() },
      second: { kind: "leaf", pane: basePane({ id: "w2", selected: false }) },
    },
  }
  presentDomFrame(t as never, split)
  expect(t.windows.querySelectorAll("window-pane").length).toBe(2)
  expect(createCount).toBeGreaterThan(0)
})

// ── t-audit2-d6617590: rAF lifecycle ────────────────────────────────────────

test("present() cancels rAFs from both presentDomFrame and direct renderCaret", async () => {
  installDom()
  const { presentDomFrame, renderCaret } = await import("../../src/display/dom-frame")
  const t = targets()
  presentDomFrame(t as never, model(basePane({ cursor: { row: 0, colOffset: 1 } })))
  const fromPresent = rafQueue.map(r => r.id)
  expect(fromPresent.length).toBeGreaterThanOrEqual(1)

  // client-bridge calls renderCaret directly for the predictive caret; its rAF
  // must be tracked in the same pending set.
  const body = t.windows.querySelectorAll("window-body")[0]!
  const rows = body.querySelectorAll("body-row")
  renderCaret(body as never, rows as never, { row: 0, colOffset: 0 }, undefined, "predicted")
  const allBefore = rafQueue.map(r => r.id)
  expect(allBefore.length).toBeGreaterThan(fromPresent.length)

  presentDomFrame(t as never, model(basePane({ cursor: { row: 1, colOffset: 0 } })))
  for (const id of allBefore) expect(cancelled.has(id)).toBe(true)
  expect(rafQueue.some(r => allBefore.includes(r.id))).toBe(false)
})

test("rAF callback that fires self-clears from the pending set", async () => {
  installDom()
  const { presentDomFrame } = await import("../../src/display/dom-frame")
  const t = targets()
  presentDomFrame(t as never, model(basePane({ cursor: { row: 0, colOffset: 0 } })))
  const [pending] = rafQueue
  expect(pending).toBeDefined()
  pending!.fn() // fires → deletes itself from pendingCaretRafs
  // Next present must not try to cancel an id that already fired.
  presentDomFrame(t as never, model(basePane({ cursor: { row: 0, colOffset: 1 } })))
  expect(cancelled.has(pending!.id)).toBe(false)
})
