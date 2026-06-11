/**
 * t-audit2-18e7a2c9: `sendMouse` hit-tests via `floor((clientY-top)/rowPx)` &
 * `floor((clientX-left)/colPx)` — a fixed monospace grid. With a variable-pitch
 * default face (or per-chunk `family`/`height`) glyphs are not 9×18 px, so the
 * click lands on the wrong (row, col). Fix: measure against the rendered
 * `.body-row` rects and Range-based glyph positions, mirroring `renderCaret`.
 *
 * t-audit2-67bb30d0 (merged, p1): `presentDomFrame` rebuilds the entire window
 * tree on every frame (`targets.windows.replaceChildren`). For terminal
 * surfaces that's `rows×cols` `createElement`+`appendChild` per keystroke.
 * Fix: diff against the previous model and patch only what changed.
 *
 * t-audit2-d6617590 (merged, p2): `renderCaret` schedules `requestAnimationFrame
 * (place)` but never cancels it. After the next `presentDomFrame` replaces the
 * body, the callback fires against detached nodes. Fix: cancel pending rAFs
 * on re-render and guard `place()` on `isConnected`.
 */
import { afterEach, expect, test } from "bun:test"
import type { SerializedDisplayModel, SerializedPane } from "../../src/display/serialize"

// ── Minimal DOM fake (no jsdom) ─────────────────────────────────────────────
// Elements report layout via per-node `_rect`; Ranges report `_rect` of the
// text-node + char offset they're collapsed at. This is enough for both the
// existing `rangeAtCharOffset` path and the new hit-test inverse.

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
const rect = (left: number, top: number, width: number, height: number): Rect =>
  ({ left, top, right: left + width, bottom: top + height, width, height })

let createCount = 0
type Listener = (ev: unknown) => void

class FakeText {
  nodeType = 3
  _glyphLefts?: number[] // px left edge of each char, plus trailing edge
  constructor(public data: string) {}
}

class FakeEl {
  nodeType = 1
  children: FakeEl[] = []
  childNodes: Array<FakeEl | FakeText> = []
  classList = new Set<string>()
  dataset: Record<string, string> = {}
  style: Record<string, string> & { setProperty?(k: string, v: string): void } = {}
  _rect: Rect = rect(0, 0, 0, 0)
  _listeners: Record<string, Listener[]> = {}
  isConnected = false
  parentNode: FakeEl | null = null
  scrollLeft = 0; scrollTop = 0
  constructor(public tagName: string) {
    this.style.setProperty = (k, v) => { this.style[k] = v }
  }
  set className(v: string) { this.classList = new Set(v.split(/\s+/).filter(Boolean)) }
  get className() { return [...this.classList].join(" ") }
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
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this._connect(false) }
  _connect(v: boolean) { this.isConnected = v; for (const c of this.children) c._connect(v) }
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.replace(/^\./, "")
    const out: FakeEl[] = []
    const walk = (el: FakeEl) => {
      if (el.classList.has(cls)) out.push(el)
      for (const c of el.children) walk(c)
    }
    for (const c of this.children) walk(c)
    return out
  }
  addEventListener(ev: string, fn: Listener) { (this._listeners[ev] ??= []).push(fn) }
  getBoundingClientRect() { return this._rect }
  scrollIntoView() {}
}

class FakeRange {
  _node?: FakeText; _off = 0
  setStart(n: FakeText, off: number) { this._node = n; this._off = off }
  setEnd(_n: FakeText, _off: number) {}
  getBoundingClientRect(): Rect {
    const lefts = this._node?._glyphLefts
    if (!lefts) return rect(0, 0, 0, 0)
    const l = lefts[Math.min(this._off, lefts.length - 1)]!
    return rect(l, 0, 0, 18)
  }
}

let rafQueue: Array<{ id: number; fn: () => void }> = []
let cancelled: number[] = []
let nextRaf = 1

const saved: Record<string, unknown> = {}
function stub(k: string, v: unknown) {
  if (!(k in saved)) saved[k] = (globalThis as Record<string, unknown>)[k]
  ;(globalThis as Record<string, unknown>)[k] = v
}
function installDom() {
  createCount = 0; rafQueue = []; cancelled = []; nextRaf = 1
  const documentElement = new FakeEl("html"); documentElement._connect(true)
  const body = new FakeEl("body"); body._connect(true)
  stub("document", {
    documentElement, body,
    getElementById: () => null,
    createElement: (tag: string) => { createCount++; return new FakeEl(tag) },
    createRange: () => new FakeRange(),
    createTreeWalker: (root: FakeEl, _what: number) => {
      const texts: FakeText[] = []
      const walk = (n: FakeEl | FakeText) => {
        if (n instanceof FakeText) texts.push(n)
        else for (const c of n.childNodes) walk(c)
      }
      walk(root)
      let i = -1
      return { nextNode: () => texts[++i] ?? null }
    },
  })
  stub("requestAnimationFrame", (fn: () => void) => { const id = nextRaf++; rafQueue.push({ id, fn }); return id })
  stub("cancelAnimationFrame", (id: number) => { cancelled.push(id); rafQueue = rafQueue.filter(r => r.id !== id) })
}
afterEach(() => { for (const [k, v] of Object.entries(saved)) (globalThis as Record<string, unknown>)[k] = v })

// ── fixtures ────────────────────────────────────────────────────────────────

const themed = (text: string, extra: Record<string, unknown> = {}) => ({ chunks: [{ text, ...extra }] })
function leafPane(body: SerializedPane["body"], cursor?: { row: number; colOffset: number }): SerializedPane {
  return {
    id: "w1", bufferId: "b1", selected: true, dedicated: false, body, cursor,
    modeline: themed(" -:-- *scratch* "), clickState: { startLine: 0, gutterPrefixLen: 0 },
    bodyLineBudget: 24, syncText: "", syncPoint: 0, textScale: 1,
  }
}
function model(pane: SerializedPane): SerializedDisplayModel {
  return {
    title: themed("jemacs"), windows: { kind: "leaf", pane }, childFrames: [],
    minibufferCompletions: themed(""), minibufferCompletionLines: 0,
    minibuffer: themed(""), echo: themed(""),
    theme: { faces: { default: { fg: "#ddd", bg: "#111", family: "Helvetica" } } } as never,
    viewport: { rows: 24, cols: 80 }, hostLabel: "test",
  }
}
function targets() {
  const mk = () => { const e = new FakeEl("div"); e._connect(true); return e }
  return { title: mk(), windows: mk(), minibuffer: mk(), echo: mk(), minibufferCompletions: mk() }
}

/** Lay out `.body-row`s with variable line heights and per-char glyph widths so
 *  fixed-grid math (`DOM_FRAME_ROW_PX=18`, `DOM_FRAME_COL_PX=9`) gives the
 *  wrong answer. */
function layoutVariablePitch(body: FakeEl, rowHeights: number[], glyphWidths: number[][]) {
  body._rect = rect(0, 0, 800, rowHeights.reduce((a, b) => a + b, 0))
  let top = 0
  const rows = body.querySelectorAll("body-row")
  rows.forEach((row, i) => {
    const h = rowHeights[i] ?? 18
    row._rect = rect(0, top, 800, h)
    let left = 0
    const widths = glyphWidths[i] ?? []
    // one text node per span; assign cumulative left edges
    let gi = 0
    for (const cn of row.childNodes) {
      for (const tn of (cn as FakeEl).childNodes) {
        if (tn instanceof FakeText) {
          const lefts: number[] = []
          for (let k = 0; k <= tn.data.length; k++) { lefts.push(left); left += widths[gi++] ?? 9 }
          left -= widths[gi - 1] ?? 9 // last push over-advanced
          tn._glyphLefts = lefts
        }
      }
    }
    top += h
  })
}

// ── t-audit2-18e7a2c9 ───────────────────────────────────────────────────────

test("mousedown hit-tests against measured row/glyph rects, not the 9×18 grid", async () => {
  installDom()
  const { presentDomFrame } = await import("../../src/display/dom-frame")
  const t = targets()
  const clicks: Array<[string, number, number]> = []
  // Variable-pitch body: row 0 is 28px tall (heightScale 1.5), glyphs are
  // [14, 6, 6, 22, 10] px wide — i.e. 'W','i','i','M','e'. Row 1 is 18px.
  const pane = leafPane(
    { chunks: [{ text: "WiiMe\nabc", family: "Helvetica", heightScale: 1.5 }] },
    { row: 0, colOffset: 0 },
  )
  presentDomFrame(t as never, model(pane), (id, r, c) => { clicks.push([id, r, c]) })
  const body = t.windows.querySelectorAll("window-body")[0]!
  layoutVariablePitch(body, [28, 18], [[14, 6, 6, 22, 10], [9, 9, 9]])

  // Click at (x=30, y=24): grid math → row floor(24/18)=1, col floor(30/9)=3.
  // Measured: y=24 is inside row 0 (0..28); x=30 is past 'W'(14)+'i'(6)+'i'(6)=26
  // and before +'M'(22)=48 → col 3. Same col here, so pick a discriminating x.
  // x=18: grid col=2; measured: 14<18<20 → col 1.
  body._listeners.mousedown![0]!({ button: 0, clientX: 18, clientY: 24, target: body })
  expect(clicks.at(-1)).toEqual(["w1", 0, 1])

  // y=20: grid row floor(20/18)=1; measured row 0 (0..28). x=50: glyph edges
  // [0,14,20,26,48,58] → col 4; grid floor(50/9)=5.
  body._listeners.mousedown![0]!({ button: 0, clientX: 50, clientY: 20, target: body })
  expect(clicks.at(-1)).toEqual(["w1", 0, 4])
})

// ── t-audit2-d6617590 ───────────────────────────────────────────────────────

test("renderCaret rAF is cancelled on re-render and guards detached body", async () => {
  installDom()
  const { presentDomFrame, renderCaret } = await import("../../src/display/dom-frame")
  const t = targets()
  const pane = leafPane(themed("hello\nworld"), { row: 0, colOffset: 2 })
  presentDomFrame(t as never, model(pane))
  expect(rafQueue.length).toBeGreaterThanOrEqual(1)
  const firstIds = rafQueue.map(r => r.id)

  // Re-render: the first render's rows + caret are replaced; the pending rAF
  // would measure detached nodes. Fix: presentDomFrame cancels it.
  presentDomFrame(t as never, model(leafPane(themed("hello!\nworld"), { row: 0, colOffset: 3 })))
  expect(firstIds.every(id => cancelled.includes(id))).toBe(true)
  expect(rafQueue.some(r => firstIds.includes(r.id))).toBe(false)

  // Direct renderCaret callers (client-bridge predictive caret) don't go
  // through presentDomFrame, so place() must also guard on connectedness.
  const detachedBody = new FakeEl("div") // isConnected = false
  const row = new FakeEl("div"); detachedBody.appendChild(row)
  let measured = false
  detachedBody.getBoundingClientRect = () => { measured = true; return rect(0, 0, 0, 0) }
  renderCaret(detachedBody as never, [row] as never, { row: 0, colOffset: 0 })
  for (const r of rafQueue) r.fn()
  expect(measured).toBe(false)
})

// ── t-audit2-67bb30d0 ───────────────────────────────────────────────────────

test("presentDomFrame patches an unchanged frame instead of rebuilding it", async () => {
  installDom()
  const { presentDomFrame } = await import("../../src/display/dom-frame")
  const t = targets()
  const pane = leafPane(themed("line 0\nline 1\nline 2"), { row: 1, colOffset: 2 })
  presentDomFrame(t as never, model(pane))
  const body0 = t.windows.querySelectorAll("window-body")[0]!
  const built = createCount
  expect(built).toBeGreaterThan(5)

  // Identical model → no new elements, same body node retained.
  createCount = 0
  presentDomFrame(t as never, model(pane))
  expect(createCount).toBe(0)
  expect(t.windows.querySelectorAll("window-body")[0]).toBe(body0)

  // Body-only change → bounded by the body rebuild, modeline/pane untouched.
  createCount = 0
  presentDomFrame(t as never, model(leafPane(themed("line 0\nline X\nline 2"), { row: 1, colOffset: 2 })))
  expect(createCount).toBeLessThan(built)
  expect(t.windows.querySelectorAll("window-body")[0]).toBe(body0)
})

test("terminal surface re-render diffs cells (perf cliff)", async () => {
  installDom()
  const { presentDomFrame } = await import("../../src/display/dom-frame")
  const t = targets()
  const cells = (ch: string) =>
    Array.from({ length: 10 }, () => Array.from({ length: 40 }, () => ({ text: ch })))
  const term = (ch: string): SerializedPane => ({
    ...leafPane(themed("")),
    terminalSurface: { kind: "terminal", rows: 10, cols: 40, cursorRow: 0, cursorCol: 0, cells: cells(ch) },
  })
  presentDomFrame(t as never, model(term("a")))
  const fullBuild = createCount // ≈ 10 rows + 400 cells + chrome

  // Change one cell → must not re-create all 400 spans.
  createCount = 0
  const next = term("a")
  next.terminalSurface!.cells[3]![5] = { text: "Z" }
  presentDomFrame(t as never, model(next))
  expect(createCount).toBeLessThan(fullBuild / 4)
})
