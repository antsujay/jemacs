/**
 * Layer-2 proof that `dist/shadow-web/editor.js` is browser-loadable: evaluate
 * the bundle against a minimal DOM/WebSocket stub (no jsdom dependency) and
 * assert `new Editor()` constructs without ReferenceError.
 *
 * This catches the failure mode where a `node:*` import leaks through the
 * build (the bundle would throw `Cannot find module "node:fs"` or
 * `ReferenceError: require is not defined` at eval time).
 */

import { beforeAll, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { buildShadowWeb } from "../../scripts/build-shadow-web"

const dist = join(import.meta.dirname, "../../dist/shadow-web/editor.js")

let bundleSource = ""

beforeAll(async () => {
  await buildShadowWeb()
  bundleSource = await readFile(dist, "utf8")
})

/** Just enough DOM for module-eval to succeed. `presentDomFrame` only runs when
 *  `#jemacs-root` is present, so a null-returning `getElementById` keeps the
 *  bundle in "global surface only" mode. */
function browserGlobals(): Record<string, unknown> {
  const listeners: Array<() => void> = []
  const fakeDoc = {
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild: () => {}, replaceChildren: () => {} }),
    documentElement: { style: {} },
    body: { style: {} },
  }
  class FakeWebSocket {
    static OPEN = 1
    readyState = 0
    constructor(public readonly url: string) {}
    addEventListener(_: string, fn: () => void): void { listeners.push(fn) }
    send(_: string): void {}
    close(): void {}
  }
  const win = { document: fakeDoc, WebSocket: FakeWebSocket, location: { host: "localhost:0" } }
  return {
    window: win,
    document: fakeDoc,
    location: win.location,
    navigator: { userAgent: "bun-test" },
    WebSocket: FakeWebSocket,
    self: win,
  }
}

type ShadowSurface = {
  Editor: new () => { buffers: Map<string, unknown>; commands: unknown }
  attachShadow: unknown
  WsLink: unknown
  connectWs: unknown
  MemCas: new () => unknown
  mountShadowEditor: (opts?: { bare?: boolean; wsUrl?: string }) => { editor: unknown; link: unknown }
}

/** Evaluate the ESM bundle in a fresh scope with browser-ish globals injected.
 *  We strip the trailing `export { ... }` (illegal inside a function body) and
 *  read the result back via the `JemacsShadow` global the entry assigns. */
async function loadBundle(): Promise<ShadowSurface> {
  const stubs = browserGlobals()
  const scope: Record<string, unknown> = { JemacsShadow: undefined, console, ...stubs }
  ;(scope as { globalThis?: unknown }).globalThis = scope
  // Bun emits a `var __require = (id) => import.meta.require(id)` preamble for
  // any leftover CJS reference; in this sandbox there's no real require, so
  // satisfy it with a stub that throws (matching node-stubs semantics).
  ;(scope as { require?: unknown }).require = (id: string) => {
    throw new Error(`require(${JSON.stringify(id)}) reached the bundle — should have been stubbed by build-shadow-web`)
  }
  const body = bundleSource
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, "")
    .replace(/\bimport\.meta\b/g, "({url:'http://localhost/editor.js'})")
  const params = Object.keys(scope)
  // AsyncFunction so any top-level `await` Bun may emit is legal.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
    new (...args: string[]) => (...a: unknown[]) => Promise<void>
  const fn = new AsyncFunction(...params, body)
  await fn(...params.map(k => scope[k]))
  const surface = (scope as { JemacsShadow?: ShadowSurface }).JemacsShadow
  if (!surface) throw new Error("bundle did not assign globalThis.JemacsShadow")
  return surface
}

test("bundle exists and contains no bare node: imports", () => {
  expect(bundleSource.length).toBeGreaterThan(1000)
  // A leaked `from "node:fs"` (etc.) means the stub plugin missed a specifier.
  expect(bundleSource).not.toMatch(/from\s*["']node:/)
  expect(bundleSource).not.toMatch(/require\(["']node:/)
})

test("Editor is a constructor and `new Editor()` succeeds", async () => {
  const { Editor } = await loadBundle()
  expect(typeof Editor).toBe("function")
  const editor = new Editor()
  expect(editor.buffers instanceof Map).toBe(true)
  // Kernel boot creates *scratch* and *Messages* without touching the FS.
  expect(editor.buffers.size).toBeGreaterThan(0)
})

test("attachShadow + WsLink are exposed and mountShadowEditor wires them", async () => {
  const surface = await loadBundle()
  expect(typeof surface.attachShadow).toBe("function")
  expect(typeof surface.WsLink).toBe("function")
  expect(typeof surface.connectWs).toBe("function")
  expect(typeof surface.MemCas).toBe("function")
  // bare:true skips installDefaultConfig so this asserts the attach path alone.
  const { editor, link } = surface.mountShadowEditor({ bare: true, wsUrl: "ws://localhost:0/shadow" })
  expect(editor).toBeDefined()
  expect(link).toBeDefined()
})
