/**
 * t-audit2-631161b0: shadow-web — no WS reconnect; save-buffer no-ops after disconnect.
 * merged t-audit2-c2915825: render() fires per 'changed' with no batching.
 * merged t-audit2-93305fba: Chrome traps Ctrl+H before the page sees it.
 */
import { afterEach, expect, test } from "bun:test"

// ── controllable WebSocket fake ─────────────────────────────────────────────
type Listener = (ev: unknown) => void
class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  private ls: Record<string, Listener[]> = {}
  constructor(public readonly url: string) { FakeWebSocket.instances.push(this) }
  addEventListener(ev: string, fn: Listener) { (this.ls[ev] ??= []).push(fn) }
  send(d: string) { this.sent.push(d) }
  close() { this.readyState = 3; this.fire("close", {}) }
  fire(ev: string, payload: unknown) { for (const f of this.ls[ev] ?? []) f(payload) }
  open() { this.readyState = FakeWebSocket.OPEN; this.fire("open", {}) }
}

// ── minimal DOM stub so mountShadowEditor can run headless ──────────────────
type KeyEv = {
  key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean
  defaultPrevented: boolean; preventDefault(): void
}
let keydown: ((ev: KeyEv) => void) | undefined
const fakeDoc = {
  getElementById: () => null,
  addEventListener: (ev: string, fn: (e: KeyEv) => void) => { if (ev === "keydown") keydown = fn },
}
const fakeWin = {
  document: fakeDoc,
  addEventListener: (ev: string, fn: (e: KeyEv) => void) => { if (ev === "keydown") keydown = fn },
}
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
  // mountShadowEditor → attachShadow installs a process-global PlatformRuntime
  // override; clear it so later tests get the real nodeRuntime.
  const { setPlatformRuntime } = await import("../../src/platform/runtime")
  setPlatformRuntime(undefined)
})

type MountExtra = { present?: () => void; targets?: unknown }
async function mount(extra: MountExtra = {}) {
  stub("WebSocket", FakeWebSocket)
  stub("document", fakeDoc)
  stub("window", fakeWin)
  stub("location", { host: "test:0" })
  stub("indexedDB", undefined)
  stub("requestAnimationFrame", undefined)
  ;(globalThis as Record<string, unknown>).__JEMACS_TOKEN__ = "tok"
  const mod = await import("../../src/web/shadow-entry")
  return mod.mountShadowEditor({ bare: true, wsUrl: "ws://test/ws", ...extra } as never)
}

// ── t-audit2-631161b0 ───────────────────────────────────────────────────────

test("save-buffer rejects (not no-ops) while the link is down", async () => {
  const { link } = await mount()
  const ws0 = FakeWebSocket.instances[0]!
  ws0.open()
  expect((link as { state?: string }).state).toBe("open")

  ws0.close()
  expect((link as { state?: string }).state).not.toBe("open")

  const { getPlatformRuntime } = await import("../../src/platform/runtime")
  const rt = getPlatformRuntime()!
  // Before fix: writeFileText resolves and the Cmd is silently dropped.
  await expect(rt.writeFileText!("/tmp/x", "body")).rejects.toThrow(/link|offline|disconnect/i)
  ;(link as { close(): void }).close()
})

test("link redials with backoff and resumes after open", async () => {
  const { link } = await mount()
  expect(FakeWebSocket.instances.length).toBe(1)
  const ws0 = FakeWebSocket.instances[0]!
  ws0.open()
  ws0.close()

  await Bun.sleep(900)
  expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2)

  const ws1 = FakeWebSocket.instances.at(-1)!
  ws1.open()
  expect((link as { state?: string }).state).toBe("open")
  // Auth must be re-sent on the fresh socket so the host gate accepts it.
  expect(ws1.sent.some(m => m.includes('"auth"'))).toBe(true)
  ;(link as { close(): void }).close()
})

test("link state surfaces in the modeline via mode-line-misc-info", async () => {
  const { editor, link } = await mount()
  const { getCustom } = await import("../../src/runtime/custom")
  type B = import("../../src/kernel/buffer").BufferModel
  const misc = getCustom<Array<(b: B) => string>>("mode-line-misc-info") ?? []
  const buf = editor.currentBuffer
  const seg = () => misc.map(f => f(buf)).join("")
  // Before open: should advertise connecting/offline, not silently blank.
  expect(seg()).toMatch(/connecting|offline|⊘|⇅/i)
  FakeWebSocket.instances[0]!.open()
  expect(seg()).not.toMatch(/offline|⊘/i)
  ;(link as { close(): void }).close()
})

// ── t-audit2-c2915825 ───────────────────────────────────────────────────────

test("a burst of 'changed' events renders once (coalesced)", async () => {
  let renders = 0
  const { editor, link } = await mount({ targets: stubTargets, present: () => { renders++ } })
  await Bun.sleep(0)
  renders = 0
  // Synchronous burst: ten emits in one turn must collapse to one frame.
  for (let i = 0; i < 10; i++) void editor.events.emit("changed", { reason: "test" })
  await Bun.sleep(0)
  // Before fix: renders === 10. After: a single coalesced frame.
  expect(renders).toBeGreaterThanOrEqual(1)
  expect(renders).toBeLessThanOrEqual(2)
  ;(link as { close(): void }).close()
})

// ── t-audit2-93305fba ───────────────────────────────────────────────────────

test("keydown handler preventDefaults Ctrl+H before dispatch", async () => {
  const { link } = await mount({ targets: stubTargets, present: () => {} })
  expect(typeof keydown).toBe("function")
  let prevented = false
  const ev: KeyEv = {
    key: "h", code: "KeyH", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false,
    defaultPrevented: false,
    preventDefault() { prevented = true; this.defaultPrevented = true },
  }
  keydown!(ev)
  expect(prevented).toBe(true)
  ;(link as { close(): void }).close()
})
