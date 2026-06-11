/**
 * Layer-2 proof that `dist/shadow-web/editor.js` is browser-loadable: evaluate
 * the bundle against a minimal DOM/WebSocket stub (no jsdom dependency) and
 * assert `new Editor()` constructs without ReferenceError.
 *
 * This catches the failure mode where a `node:*` import leaks through the
 * build (the bundle would throw `Cannot find module "node:fs"` or
 * `ReferenceError: require is not defined` at eval time).
 *
 * The eval sandbox explicitly shadows every Node/Bun-only global as
 * `undefined`, so a stray `process.cwd()` or `Buffer.from()` that a real
 * browser would reject as `ReferenceError` fails here too — instead of
 * silently resolving to Bun's runtime globals the way it did when the sandbox
 * only *added* browser stubs without *removing* Node ones.
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

/** Globals that exist under `bun test` but NOT in a browser page. Each becomes
 *  a function parameter bound to `undefined`, so inside the sandbox
 *  `typeof process === "undefined"` (matching browser feature-detection) and
 *  `process.x` throws — the same outcome a real page gives, modulo TypeError
 *  vs ReferenceError. Browser-standard globals (setTimeout, URL, crypto,
 *  TextEncoder, …) are deliberately left to fall through to Bun's runtime
 *  since they exist in both environments. */
const NODE_ONLY_GLOBALS = [
  "process",
  "Buffer",
  "Bun",
  "global",
  "__dirname",
  "__filename",
  "module",
  "exports",
  "setImmediate",
  "clearImmediate",
] as const

type ShadowSurface = {
  Editor: new () => { buffers: Map<string, unknown>; commands: unknown }
  attachShadow: unknown
  WsLink: unknown
  connectWs: unknown
  MemCas: new () => unknown
  mountShadowEditor: (opts?: { bare?: boolean; wsUrl?: string }) => { editor: unknown; link: unknown }
}

/** Evaluate `source` in a fresh scope with browser-ish globals injected and
 *  Node-only globals stripped. We strip the trailing `export { ... }` (illegal
 *  inside a function body) and read the result back via the `JemacsShadow`
 *  global the entry assigns. `extraScope` lets a test re-inject a shimmed
 *  global on top of the stripped baseline. */
async function evalInBrowserSandbox(
  source: string,
  extraScope: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const stubs = browserGlobals()
  const scope: Record<string, unknown> = { JemacsShadow: undefined, console, ...stubs }
  for (const name of NODE_ONLY_GLOBALS) scope[name] = undefined
  Object.assign(scope, extraScope)
  ;(scope as { globalThis?: unknown }).globalThis = scope
  // Bun emits a `var __require = (id) => import.meta.require(id)` preamble for
  // any leftover CJS reference; in this sandbox there's no real require, so
  // satisfy it with a stub that throws (matching node-stubs semantics).
  ;(scope as { require?: unknown }).require = (id: string) => {
    throw new Error(`require(${JSON.stringify(id)}) reached the bundle — should have been stubbed by build-shadow-web`)
  }
  const body = source
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, "")
    .replace(/\bimport\.meta\b/g, "({url:'http://localhost/editor.js'})")
  const params = Object.keys(scope)
  // AsyncFunction so any top-level `await` Bun may emit is legal.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
    new (...args: string[]) => (...a: unknown[]) => Promise<void>
  const fn = new AsyncFunction(...params, body)
  await fn(...params.map(k => scope[k]))
  return scope
}

async function loadBundle(extraScope: Record<string, unknown> = {}): Promise<ShadowSurface> {
  const scope = await evalInBrowserSandbox(bundleSource, extraScope)
  const surface = (scope as { JemacsShadow?: ShadowSurface }).JemacsShadow
  if (!surface) throw new Error("bundle did not assign globalThis.JemacsShadow")
  return surface
}

/** Known leak: `src/runtime/source.ts` `captureCallerSource` calls
 *  `path.resolve(file)` on a stack-frame URL; the posix-path polyfill treats a
 *  URL as relative and reaches `process.cwd()`. Top-level `defface()` calls hit
 *  this at module-eval time, so a real browser throws `ReferenceError: process
 *  is not defined` on load. The functional tests below shim *only* `process`
 *  back in so we keep regression coverage on the rest of the surface; the
 *  `test.failing` case asserts the fully-stripped contract and flips green
 *  once `captureCallerSource` is browser-safe. */
const KNOWN_PROCESS_LEAK_SHIM = {
  process: { cwd: () => "/", env: {}, platform: "browser", argv: [] as string[] },
}

test("bundle exists and contains no bare node: imports", () => {
  expect(bundleSource.length).toBeGreaterThan(1000)
  // A leaked `from "node:fs"` (etc.) means the stub plugin missed a specifier.
  expect(bundleSource).not.toMatch(/from\s*["']node:/)
  expect(bundleSource).not.toMatch(/require\(["']node:/)
})

test("sandbox strips Node globals (harness self-check)", async () => {
  // Independent of the bundle: prove the eval harness actually hides Bun's
  // node globals. If this regresses, the `test.failing` below is meaningless.
  expect(typeof process).toBe("object") // outer scope: Bun's process is live
  const probe = `globalThis.JemacsShadow = {
    process: typeof process,
    Buffer: typeof Buffer,
    Bun: typeof Bun,
    global: typeof global,
    setImmediate: typeof setImmediate,
    crypto: typeof crypto,
    setTimeout: typeof setTimeout,
  }`
  const scope = await evalInBrowserSandbox(probe)
  const seen = scope.JemacsShadow as Record<string, string>
  for (const g of ["process", "Buffer", "Bun", "global", "setImmediate"]) {
    expect(seen[g]).toBe("undefined")
  }
  // Browser-standard globals must still be reachable.
  expect(seen.crypto).toBe("object")
  expect(seen.setTimeout).toBe("function")
})

test.failing("bundle evaluates with all Node globals stripped", async () => {
  // Contract: the bundle is loadable in a page with no Node globals. Currently
  // throws on `process.cwd()` — see KNOWN_PROCESS_LEAK_SHIM above. Remove
  // `.failing` (and the shim) once the leak is closed.
  const { Editor } = await loadBundle()
  expect(typeof Editor).toBe("function")
  const editor = new Editor()
  expect(editor.buffers instanceof Map).toBe(true)
})

test("Editor is a constructor and `new Editor()` succeeds", async () => {
  const { Editor } = await loadBundle(KNOWN_PROCESS_LEAK_SHIM)
  expect(typeof Editor).toBe("function")
  const editor = new Editor()
  expect(editor.buffers instanceof Map).toBe(true)
  // Kernel boot creates *scratch* and *Messages* without touching the FS.
  expect(editor.buffers.size).toBeGreaterThan(0)
})

test("attachShadow + WsLink are exposed and mountShadowEditor wires them", async () => {
  const surface = await loadBundle(KNOWN_PROCESS_LEAK_SHIM)
  expect(typeof surface.attachShadow).toBe("function")
  expect(typeof surface.WsLink).toBe("function")
  expect(typeof surface.connectWs).toBe("function")
  expect(typeof surface.MemCas).toBe("function")
  // bare:true skips installDefaultConfig so this asserts the attach path alone.
  const { editor, link } = surface.mountShadowEditor({ bare: true, wsUrl: "ws://localhost:0/shadow" })
  expect(editor).toBeDefined()
  expect(link).toBeDefined()
})
