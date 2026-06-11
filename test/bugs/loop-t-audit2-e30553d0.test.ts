import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Editor } from "../../src/kernel/editor"
import { installDefaultConfig } from "../../src/config"
import { installDefaultModes } from "../../src/modes/default-modes"
import { runJemacsCore } from "../../src/run-core"
import { createWebHost, type WebHost } from "../../src/web/host"

let host: WebHost | undefined
const tmpDirs: string[] = []

afterEach(() => {
  host?.destroy()
  host = undefined
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "jemacs-host-"))
  tmpDirs.push(d)
  return d
}

async function makeShadowHost(fsRoot?: string): Promise<WebHost> {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  const h = await createWebHost({ port: 0, authTimeoutMs: 200, shadow: true, fsRoot: fsRoot ?? tmp() })
  h.attachEditor(editor)
  return h
}

async function makeThinHost(): Promise<WebHost> {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("web-test", "hello", "text")
  const h = await createWebHost({ port: 0, authTimeoutMs: 200 })
  h.attachEditor(editor)
  await runJemacsCore(editor, h)
  return h
}

function wsOpen(ws: WebSocket): Promise<void> {
  return new Promise(r => ws.addEventListener("open", () => r(), { once: true }))
}
function wsClosed(ws: WebSocket): Promise<number> {
  return new Promise(r => ws.addEventListener("close", e => r(e.code), { once: true }))
}

// ─── primary: t-audit2-e30553d0 ─── shadow HTML omits stylesheet so the
// CSS-positioned caret never moves. Also covers t-audit2-23c07cf0 (missing
// #jemacs-minibuffer-completions mount point).
test("shadow / serves a styled page with all DOM mount points", async () => {
  host = await makeShadowHost()
  const res = await fetch(`http://127.0.0.1:${host.port}/`, {
    headers: { Host: `127.0.0.1:${host.port}` },
  })
  expect(res.status).toBe(200)
  const html = await res.text()
  // .jemacs-caret is `position:absolute` in renderer.css; without the link the
  // caret div renders inline at body end and never tracks point.
  expect(html).toContain(`rel="stylesheet"`)
  expect(html).toContain("/renderer.css")
  // fido/vertico render into this id; shadow-entry treats it as optional but
  // without it the candidate list is silently dropped.
  expect(html).toContain(`id="jemacs-minibuffer-completions"`)

  const css = await fetch(`http://127.0.0.1:${host.port}/renderer.css`, {
    headers: { Host: `127.0.0.1:${host.port}` },
  })
  expect(css.status).toBe(200)
  expect(await css.text()).toContain(".jemacs-caret")
})

// ─── t-audit2-3b02a351 ─── favicon 404 noise on every page load.
test("/favicon.ico returns 204 instead of 404", async () => {
  host = await makeShadowHost()
  const res = await fetch(`http://127.0.0.1:${host.port}/favicon.ico`, {
    headers: { Host: `127.0.0.1:${host.port}` },
  })
  expect(res.status).toBe(204)
})

// ─── t-audit2-9b87128c ─── CSWSH: /ws upgrade ignored Origin, Host compare
// was case-sensitive.
test("hostAllowed: case-insensitive Host; /ws rejects foreign Origin", async () => {
  host = await makeThinHost()
  // Mixed-case Host must be accepted (browsers may send `Localhost`).
  const ok = await fetch(`http://127.0.0.1:${host.port}/`, {
    headers: { Host: `LOCALHOST:${host.port}` },
  })
  expect(ok.status).toBe(200)

  // Cross-origin page opening the socket: browsers always send Origin on WS;
  // a mismatched one must not even reach the auth gate.
  const bad = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, {
    // @ts-expect-error bun extension
    headers: { Origin: "https://evil.example" },
  })
  expect(await wsClosed(bad)).not.toBe(1000)

  // Same-origin (or no Origin, i.e. CLI client) must still connect.
  const good = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, {
    // @ts-expect-error bun extension
    headers: { Origin: `http://127.0.0.1:${host.port}` },
  })
  await wsOpen(good)
  good.send(JSON.stringify({ type: "auth", token: host.token }))
  await new Promise(r => good.addEventListener("message", r, { once: true }))
  good.close()
})

// ─── t-audit2-837d7a71 ─── fs.watch over a tree with a dangling symlink throws
// ENOENT during the recursive walk; that took the whole server down on attach.
test("nodeWatcher: dangling symlink under fsRoot does not crash attach", async () => {
  const root = tmp()
  writeFileSync(join(root, "a.txt"), "x")
  symlinkSync(join(root, "missing"), join(root, "broken"))
  host = await makeShadowHost(root)

  const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws`)
  await wsOpen(ws)
  let closed: number | undefined
  ws.addEventListener("close", e => { closed = e.code })
  ws.send(JSON.stringify({ type: "auth", token: host.token }))
  // attachShadowLink runs on auth and kicks off both fs.watch and the manifest
  // seed walk. Either path hitting the broken symlink unhandled brings the
  // socket (or the process) down.
  await new Promise(r => setTimeout(r, 150))
  expect(closed).toBeUndefined()
  expect(ws.readyState).toBe(WebSocket.OPEN)
  ws.close()
})

// ─── t-audit2-df2a71a8 ─── present() discards the incoming DisplayModel and
// rebuilds via buildLogicalModel/webLayout. Not fixable inside host.ts alone:
// `webLayout(LogicalModel)` is the only path that emits `pane.cursor` (the
// char-grid `DisplayModel` overwrites the char under point with █), and
// test/web/host.test.ts asserts both "hello" body and `cursor`. The real fix
// is for `bindJemacsHost` to hand pixel hosts the LogicalModel; tracked there.
