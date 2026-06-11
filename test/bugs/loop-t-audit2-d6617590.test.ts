/**
 * t-audit2-d6617590: `renderCaret` schedules `requestAnimationFrame(place)` and
 * the prior fix (363a1d3) guards `place()` on `body.isConnected`. But the body
 * element is *reused* across renders (patchPane diff path; client-bridge
 * predictive caret), so `body.isConnected` stays true while the caret it
 * positions — and the row it measures — have been detached by `replaceChildren`
 * / `.jemacs-caret`.remove(). The stale rAF then measures a detached row (0×0
 * rect) and styles + scrollIntoView a detached caret.
 *
 * Fix: guard on `caret.isConnected`. The caret is a child of `body`, so this
 * also covers the body-detached case the old guard handled.
 */
import { afterEach, expect, test } from "bun:test"

// ── Minimal DOM fake — just enough for renderCaret ──────────────────────────
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
const zero: Rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }

class FakeEl {
  children: FakeEl[] = []
  childNodes: FakeEl[] = []
  classList = { add() {}, remove() {}, has: () => false }
  style: Record<string, string> = {}
  isConnected = false
  parentNode: FakeEl | null = null
  scrollLeft = 0; scrollTop = 0
  set className(_v: string) {}
  set textContent(_v: string) {}
  appendChild(c: FakeEl) {
    this.children.push(c); this.childNodes.push(c)
    c.parentNode = this; c._connect(this.isConnected)
    return c
  }
  replaceChildren(...cs: FakeEl[]) {
    for (const old of this.children) { old.parentNode = null; old._connect(false) }
    this.children = []; this.childNodes = []
    for (const c of cs) this.appendChild(c)
  }
  remove() {
    const p = this.parentNode
    if (p) { p.children = p.children.filter(c => c !== this); p.childNodes = p.childNodes.filter(c => c !== this) }
    this.parentNode = null; this._connect(false)
  }
  _connect(v: boolean) { this.isConnected = v; for (const c of this.children) c._connect(v) }
  querySelectorAll(_sel: string): FakeEl[] { return [] }
  getBoundingClientRect(): Rect { return zero }
  scrollIntoView() {}
}

let rafQueue: Array<{ id: number; fn: () => void }> = []
let nextRaf = 1
const saved: Record<string, unknown> = {}
function stub(k: string, v: unknown) {
  if (!(k in saved)) saved[k] = (globalThis as Record<string, unknown>)[k]
  ;(globalThis as Record<string, unknown>)[k] = v
}
function installDom() {
  rafQueue = []; nextRaf = 1
  stub("document", {
    createElement: () => new FakeEl(),
    createRange: undefined,
    createTreeWalker: () => ({ nextNode: () => null }),
  })
  stub("requestAnimationFrame", (fn: () => void) => { const id = nextRaf++; rafQueue.push({ id, fn }); return id })
  stub("cancelAnimationFrame", (id: number) => { rafQueue = rafQueue.filter(r => r.id !== id) })
}
afterEach(() => { for (const [k, v] of Object.entries(saved)) (globalThis as Record<string, unknown>)[k] = v })

// ── repro ───────────────────────────────────────────────────────────────────

test("stale rAF bails when its caret was detached from a still-connected body", async () => {
  installDom()
  const { renderCaret, renderBodyRows } = await import("../../src/display/dom-frame")

  // Connected body — mirrors patchPane's persisted `dom.bodyEl`.
  const body = new FakeEl(); body._connect(true)
  const row = new FakeEl(); body.appendChild(row)

  renderCaret(body as never, [row] as never, { row: 0, colOffset: 0 })
  expect(rafQueue.length).toBe(1)
  const stale = rafQueue[0]!
  const caret = body.children.at(-1)!

  // client-bridge predictive path: drop the old caret, paint a new one. No
  // presentDomFrame in between → nothing cancels `stale`.
  caret.remove()
  renderCaret(body as never, [row] as never, { row: 0, colOffset: 1 })
  expect(body.isConnected).toBe(true)
  expect(caret.isConnected).toBe(false)

  // Fire the stale rAF. It must not measure the (still-connected) body nor
  // scroll the detached caret.
  let measured = false
  let scrolled = false
  body.getBoundingClientRect = () => { measured = true; return zero }
  caret.scrollIntoView = () => { scrolled = true }
  stale.fn()
  expect(measured).toBe(false)
  expect(scrolled).toBe(false)

  // Same gap via the diff path: renderBodyRows replaceChildren()s the body,
  // detaching both the row the closure measures and the caret it positions.
  rafQueue = []
  const row2 = new FakeEl(); body.replaceChildren(row2)
  renderCaret(body as never, [row2] as never, { row: 0, colOffset: 0 })
  const stale2 = rafQueue[0]!
  renderBodyRows(body as never, { chunks: [{ text: "x" }] })
  expect(row2.isConnected).toBe(false)
  let measuredRow = false
  row2.getBoundingClientRect = () => { measuredRow = true; return zero }
  stale2.fn()
  expect(measuredRow).toBe(false)
})
