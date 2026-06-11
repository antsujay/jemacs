/**
 * t-qa-9dc2de4e — live `--web --shadow` smoke against headless Chromium.
 *
 * Regression for "process global shim must precede module load": before the
 * fix, `dist/shadow-web/editor.js` evaluated before `globalThis.process` was
 * defined, so the page threw `ReferenceError: process is not defined` at
 * module-eval time and `.window-body` never rendered. `loadHtml()` now injects
 * the shim ahead of the `<script src="/editor.js">` tag; this test asserts the
 * end-to-end result — a real browser loads the page and renders buffer text.
 *
 * Gated like `qa.test.ts`: needs a Chromium binary, so skipped under
 * `JEMACS_SKIP_TUI` / CI. `shadow-bundle.test.ts` covers the same contract at
 * the eval-sandbox layer and runs everywhere.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { launch, type Driver } from "./cdp-driver"

const CHROMIUM = process.env.CHROMIUM_PATH
  ?? "/nix/store/68h63fg3qyv62lkvmqpkdk8g8qnldzhp-chromium-147.0.7727.137/bin/chromium"
const SKIP = !!process.env.JEMACS_SKIP_TUI || !!process.env.CI || !existsSync(CHROMIUM)

describe.skipIf(SKIP)("web --shadow live (headless Chromium)", () => {
  // Randomized to dodge a stale server from a crashed prior run.
  const PORT = 18200 + Math.floor(Math.random() * 500)
  const repo = join(import.meta.dirname, "../..")
  let server: ChildProcess
  let d: Driver

  const bodyText = () => d.eval<string>("document.querySelector('.window-body')?.textContent ?? ''")
  const modeline = () => d.eval<string>("document.querySelector('.window-modeline')?.textContent ?? ''")

  beforeAll(async () => {
    // fsRoot at examples/ so the recursive fs.watch in host.ts doesn't recurse
    // into node_modules.
    server = spawn(
      "bun",
      ["run", join(repo, "src/main.ts"), "--web", "--shadow", "--port", String(PORT), "docs/guide.md"],
      { cwd: join(repo, "examples"), stdio: "ignore", env: { ...process.env, JEMACS_HOME: repo } },
    )
    // Wait for the bundle route specifically — `/` returns 200 as soon as the
    // server binds, but `/editor.js` only after `WebHost.create()` has resolved.
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 100))
      const ok = await fetch(`http://127.0.0.1:${PORT}/editor.js`, { method: "HEAD" })
        .then(r => r.ok).catch(() => false)
      if (ok) break
    }
    d = await launch(`http://127.0.0.1:${PORT}/`)
  }, 30000)

  afterAll(async () => {
    await d?.close()
    server?.kill()
  })

  test(".window-body renders markdown buffer content", async () => {
    // Shadow attach is several async hops (WS auth → announceBuffer →
    // buffer-ref → want/chunk → switch-to-buffer → render); poll generously.
    let body = ""
    for (let i = 0; i < 80 && !body.includes("Guide"); i++) {
      await new Promise(r => setTimeout(r, 100))
      body = await bodyText()
    }
    expect(body.length).toBeGreaterThan(0)
    expect(body).toContain("Guide")
    expect(body).toContain("Install")
    expect(await modeline()).toContain("guide.md")
  }, 15000)

  test("page exposes the auth token and the process shim", async () => {
    expect(await d.eval<boolean>("!!window.__JEMACS_TOKEN__")).toBe(true)
    // The shim sets `process.browser = true`; a real Node `process` would not.
    expect(await d.eval<boolean>("globalThis.process?.browser === true")).toBe(true)
  })
})
