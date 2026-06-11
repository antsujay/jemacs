/**
 * t-audit2-c2915825: shadow-entry wired `editor.events.on("changed", () => render())`
 * with no batching, so a single command that emits N `changed` events (e.g. a
 * macro replay or a multi-splice paste) ran N full layout+DOM passes per turn.
 * Fix: `scheduleRender` flag-gates and defers to rAF (microtask fallback), so a
 * synchronous burst collapses to one frame.
 *
 * t-audit2-93305fba (merged): Chrome traps Ctrl+H for its history pane before
 * the page's bubble-phase handler runs, so `C-h k` (describe-key) was unreachable.
 * Fix: capture-phase keydown listener that preventDefaults *before* dispatch,
 * plus `<f1>` mirrors of the help map as a belt-and-braces alternate.
 */
import { afterEach, expect, test } from "bun:test"

// ── headless stubs ──────────────────────────────────────────────────────────
type Listener = (ev: unknown) => void
class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  private ls: Record<string, Listener[]> = {}
  constructor(public readonly url: string) { FakeWebSocket.instances.push(this) }
  addEventListener(ev: string, fn: Listener) { (this.ls[ev] ??= []).push(fn) }
  send(_d: string) {}
  close() { this.readyState = 3; for (const f of this.ls.close ?? []) f({}) }
}

type KeyEv = {
  key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean
  defaultPrevented: boolean; preventDefault(): void
}
let keydown: { fn: (ev: KeyEv) => void; capture: boolean } | undefined
const fakeWin = {
  addEventListener: (ev: string, fn: (e: KeyEv) => void, opts?: boolean | { capture?: boolean }) => {
    if (ev === "keydown") keydown = { fn, capture: opts === true || (typeof opts === "object" && !!opts?.capture) }
  },
}
const fakeDoc = { getElementById: () => null, addEventListener: fakeWin.addEventListener }
const stubTargets = { title: {}, windows: {}, minibuffer: {}, echo: {} } as
  unknown as import("../../src/display/dom-frame").DomFrameTargets

const saved: Record<string, unknown> = {}
function stub(k: string, v: unknown) {
  if (!(k in saved)) saved[k] = (globalThis as Record<string, unknown>)[k]
  ;(globalThis as Record<string, unknown>)[k] = v
}
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) (globalThis as Record<string, unknown>)[k] = v
  FakeWebSocket.instances.length = 0
  keydown = undefined
  // attachShadow installs a process-global runtime override; clear it so other
  // test files see the real nodeRuntime.
  const { setPlatformRuntime } = await import("../../src/platform/runtime")
  setPlatformRuntime(undefined)
})

async function mount(present: () => void) {
  stub("WebSocket", FakeWebSocket)
  stub("document", fakeDoc)
  stub("window", fakeWin)
  stub("location", { host: "test:0" })
  stub("indexedDB", undefined)
  // Force the queueMicrotask path so the test is deterministic without a frame clock.
  stub("requestAnimationFrame", undefined)
  const { mountShadowEditor } = await import("../../src/web/shadow-entry")
  return mountShadowEditor({ bare: true, wsUrl: "ws://test/ws", targets: stubTargets, present } as never)
}

// ── t-audit2-c2915825 ───────────────────────────────────────────────────────

test("burst of 'changed' events coalesces into one render", async () => {
  let renders = 0
  const { editor, link } = await mount(() => { renders++ })
  await Bun.sleep(0) // drain mount-time scheduleRender
  renders = 0

  for (let i = 0; i < 10; i++) void editor.events.emit("changed", { reason: "test" })
  expect(renders).toBe(0) // deferred — nothing in this turn
  await Bun.sleep(0)
  // Before fix: 10. After: one coalesced frame (allow ≤2 for any chained schedule).
  expect(renders).toBeGreaterThanOrEqual(1)
  expect(renders).toBeLessThanOrEqual(2)

  // And a follow-up burst still renders — the `scheduled` latch resets.
  renders = 0
  for (let i = 0; i < 5; i++) void editor.events.emit("changed", { reason: "test" })
  await Bun.sleep(0)
  expect(renders).toBeGreaterThanOrEqual(1)
  expect(renders).toBeLessThanOrEqual(2)

  link.close()
})

// ── t-audit2-93305fba ───────────────────────────────────────────────────────

test("keydown listener is capture-phase and preventDefaults Ctrl+H", async () => {
  const { link } = await mount(() => {})
  expect(keydown).toBeDefined()
  // Capture phase is what beats Chrome's own Ctrl+H interception.
  expect(keydown!.capture).toBe(true)

  let prevented = false
  keydown!.fn({
    key: "h", code: "KeyH", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false,
    defaultPrevented: false,
    preventDefault() { prevented = true; this.defaultPrevented = true },
  })
  expect(prevented).toBe(true)
  link.close()
})

test("<f1> k is bound as a C-h k alternate (describe-key)", async () => {
  const { editor, link } = await mount(() => {})
  expect(editor.keymap.get("f1 k")).toBe("describe-key")
  expect(editor.keymap.get("f1 b")).toBe("describe-bindings")
  link.close()
})
