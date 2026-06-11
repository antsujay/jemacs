/**
 * t-qa-9dc2de4e + merged audit2 items targeting `src/web/host.ts`:
 *  - process-global shim must precede `/editor.js` in the shadow page
 *  - t-audit2-9b87128c: `/ws` upgrade checks `Origin`; `Host` compare is case-insensitive
 *  - t-audit2-3b02a351: `/favicon.ico` answers 204 (no console-noise 404)
 *
 * Live-Chromium coverage for the shim ordering lives in
 * `test/web/shadow-live.test.ts`; these are the unit-level guards.
 */
import { afterEach, expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { installDefaultConfig } from "../../src/config"
import { installDefaultModes } from "../../src/modes/default-modes"
import { runJemacsCore } from "../../src/run-core"
import { createWebHost, type WebHost } from "../../src/web/host"

let host: WebHost | undefined

afterEach(() => {
  host?.destroy()
  host = undefined
})

async function makeHost(opts: { shadow?: boolean } = {}): Promise<WebHost> {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("qa", "hello", "text")
  const h = await createWebHost({ port: 0, authTimeoutMs: 200, ...opts })
  h.attachEditor(editor)
  await runJemacsCore(editor, h)
  return h
}

function wsClosed(ws: WebSocket): Promise<{ code: number }> {
  return new Promise(resolve => ws.addEventListener("close", e => resolve({ code: e.code })))
}

test("shadow page injects globalThis.process before /editor.js", async () => {
  host = await makeHost({ shadow: true })
  const html = await fetch(`http://127.0.0.1:${host.port}/`, {
    headers: { Host: `127.0.0.1:${host.port}` },
  }).then(r => r.text())
  const shimAt = html.indexOf("globalThis.process")
  const bundleAt = html.indexOf("/editor.js")
  expect(shimAt).toBeGreaterThan(-1)
  expect(bundleAt).toBeGreaterThan(-1)
  expect(shimAt).toBeLessThan(bundleAt)
  // Token script must also precede the bundle so `mountShadowEditor` can read it.
  expect(html.indexOf("__JEMACS_TOKEN__")).toBeLessThan(bundleAt)
})

test("Host header compare is case-insensitive (t-audit2-9b87128c)", async () => {
  host = await makeHost()
  const res = await fetch(`http://127.0.0.1:${host.port}/`, {
    headers: { Host: `LOCALHOST:${host.port}` },
  })
  expect(res.status).toBe(200)
})

test("/ws upgrade rejects foreign Origin (t-audit2-9b87128c)", async () => {
  host = await makeHost()
  const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, {
    // @ts-expect-error — Bun extension: per-connection request headers
    headers: { Origin: "https://evil.example" },
  })
  // Upgrade is refused with 403 → client sees an error/close, never `open`.
  const result = await Promise.race([
    new Promise<"open">(r => ws.addEventListener("open", () => r("open"), { once: true })),
    new Promise<"error">(r => ws.addEventListener("error", () => r("error"), { once: true })),
    wsClosed(ws).then(() => "close" as const),
  ])
  expect(result).not.toBe("open")
  ws.close()
})

test("/ws upgrade accepts same-origin Origin", async () => {
  host = await makeHost()
  const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, {
    // @ts-expect-error — Bun extension
    headers: { Origin: `http://127.0.0.1:${host.port}` },
  })
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res(), { once: true })
    ws.addEventListener("error", () => rej(new Error("ws errored on same-origin upgrade")), { once: true })
  })
  ws.close()
})

test("/favicon.ico returns 204 (t-audit2-3b02a351)", async () => {
  host = await makeHost()
  const res = await fetch(`http://127.0.0.1:${host.port}/favicon.ico`, {
    headers: { Host: `127.0.0.1:${host.port}` },
  })
  expect(res.status).toBe(204)
})
