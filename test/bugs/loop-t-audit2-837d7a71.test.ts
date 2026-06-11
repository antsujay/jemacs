import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Editor } from "../../src/kernel/editor"
import { installDefaultConfig } from "../../src/config"
import { installDefaultModes } from "../../src/modes/default-modes"
import { createWebHost, type WebHost } from "../../src/web/host"

// t-audit2-837d7a71: `nodeWatcher` wraps `fs.watch(root, {recursive:true})`,
// whose initial directory walk emitted ENOENT on a dangling symlink. With no
// `'error'` listener that became an unhandled throw and killed the process the
// moment a shadow client authed. Same tree also broke the manifest seed walk
// (`nodeFs.readdir → stat`). Both paths must now skip the broken entry.
//
// Merged into this task and fixed in the same host.ts pass (see also
// loop-t-audit2-e30553d0.test.ts which landed first with overlapping coverage):
//   t-audit2-9b87128c  /ws Origin check + case-insensitive Host
//   t-audit2-23c07cf0  shadow HTML missing #jemacs-minibuffer-completions
//   t-audit2-3b02a351  /favicon.ico 404 → 204
//   t-audit2-df2a71a8  present() discards DisplayModel — see note at bottom.

let host: WebHost | undefined
const tmpDirs: string[] = []

afterEach(() => {
  host?.destroy()
  host = undefined
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "jemacs-837d-"))
  tmpDirs.push(d)
  return d
}

async function shadowHost(fsRoot: string): Promise<WebHost> {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  const h = await createWebHost({ port: 0, authTimeoutMs: 200, shadow: true, fsRoot })
  h.attachEditor(editor)
  return h
}

test("shadow attach over fsRoot with a dangling symlink survives watch + manifest seed", async () => {
  const root = tmp()
  mkdirSync(join(root, "sub"))
  writeFileSync(join(root, "sub", "real.txt"), "x")
  // Broken link at top level *and* nested — recursive walk visits both.
  symlinkSync(join(root, "nope"), join(root, "broken"))
  symlinkSync(join(root, "also-nope"), join(root, "sub", "broken2"))

  host = await shadowHost(root)
  const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws`)
  await new Promise<void>(r => ws.addEventListener("open", () => r(), { once: true }))
  let closed: number | undefined
  ws.addEventListener("close", e => { closed = e.code })
  ws.send(JSON.stringify({ type: "auth", token: host.token }))
  // attachShadowLink fires on auth: starts fs.watch(root,{recursive}) and
  // buildManifest(fsRoot). Pre-fix either path threw and the socket dropped.
  await new Promise(r => setTimeout(r, 150))
  expect(closed).toBeUndefined()
  expect(ws.readyState).toBe(WebSocket.OPEN)
  ws.close()
})

test("merged host.ts hardening: Host case-fold, /ws Origin gate, completions mount, favicon 204", async () => {
  host = await shadowHost(tmp())
  const base = `http://127.0.0.1:${host.port}`

  // 9b87128c — Host header compare must be case-insensitive.
  const page = await fetch(`${base}/`, { headers: { Host: `LocalHost:${host.port}` } })
  expect(page.status).toBe(200)
  const html = await page.text()
  // 23c07cf0 — fido/vertico mount point present in served shadow HTML.
  expect(html).toContain(`id="jemacs-minibuffer-completions"`)

  // 3b02a351 — no 404 noise for the browser's automatic favicon probe.
  const fav = await fetch(`${base}/favicon.ico`, { headers: { Host: `127.0.0.1:${host.port}` } })
  expect(fav.status).toBe(204)

  // 9b87128c — foreign Origin on the WS upgrade is refused before auth.
  const bad = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, {
    // @ts-expect-error bun extension: headers on WebSocket ctor
    headers: { Origin: "https://evil.example" },
  })
  const code = await new Promise<number>(r => bad.addEventListener("close", e => r(e.code), { once: true }))
  expect(code).not.toBe(1000)
})

// t-audit2-df2a71a8 — `present(model)` ignores `model` and rebuilds via
// buildLogicalModel→webLayout. Intentional within host.ts: the incoming model
// is char-grid (cursor baked in as █), but the DOM client needs `pane.cursor`
// coordinates that only `webLayout(LogicalModel)` produces — and
// test/web/host.test.ts pins that. The wasted upstream build belongs to
// `bindJemacsHost` (give pixel hosts the LogicalModel directly); out of scope
// for an `OWNS: src/web/host.ts` change.
