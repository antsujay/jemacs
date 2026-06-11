/**
 * t-audit2-3b6d6a8d: cdp-driver gains persistent profile + console capture.
 *
 * Before: chromium launched with the URL on the CLI and no --user-data-dir, so
 *   (a) every launch got a fresh profile — couldn't QA IDB/localStorage
 *       persistence across reloads, and
 *   (b) page scripts ran before the CDP socket was up, so mount-time
 *       console.error / uncaught exceptions were invisible to the test.
 *
 * After: `launch(url, { userDataDir })` threads `--user-data-dir`, opens
 *   about:blank first, enables Runtime, then navigates — `driver.consoleLog`
 *   sees the page's very first script. Uncaught exceptions surface as
 *   `[exception] …` entries.
 *
 * Gated on the chromium binary only (not JEMACS_SKIP_TUI — this test owns its
 * own server + browser lifecycle and doesn't touch tmux).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { launch, type Driver } from "../web/cdp-driver"

const CHROMIUM = process.env.CHROMIUM_PATH
  ?? "/nix/store/68h63fg3qyv62lkvmqpkdk8g8qnldzhp-chromium-147.0.7727.137/bin/chromium"
const SKIP = !existsSync(CHROMIUM)

describe.skipIf(SKIP)("t-audit2-3b6d6a8d: cdp-driver userDataDir + console capture", () => {
  const PORT = 18700 + Math.floor(Math.random() * 200)
  const profile = mkdtempSync(join(tmpdir(), "jemacs-cdp-"))
  let server: ReturnType<typeof Bun.serve>

  // Minimal page: logs at mount, throws once, and renders a .window-modeline so
  // launch()'s readiness poll resolves. visitCount is bumped in localStorage so
  // the second launch can observe profile persistence.
  const html = `<!doctype html><html><body>
    <div class="window-modeline">ready</div>
    <script>
      console.log("mount-ok", location.href);
      const n = (Number(localStorage.getItem("visitCount")) || 0) + 1;
      localStorage.setItem("visitCount", String(n));
      setTimeout(() => { throw new Error("boom-after-mount") }, 0);
    </script>
  </body></html>`

  beforeAll(() => {
    server = Bun.serve({
      port: PORT,
      fetch: () => new Response(html, { headers: { "content-type": "text/html" } }),
    })
  })
  afterAll(() => {
    server?.stop(true)
    rmSync(profile, { recursive: true, force: true })
  })

  let d1: Driver
  test("captures mount-time console + exceptions", async () => {
    d1 = await launch(`http://127.0.0.1:${PORT}/`, { userDataDir: profile })
    // Give the queued throw a tick to fire and the CDP event to arrive.
    await new Promise(r => setTimeout(r, 200))
    const log = d1.consoleLog.join("\n")
    expect(log).toContain("[log] mount-ok")
    expect(log).toMatch(/\[exception].*boom-after-mount/)
    expect(await d1.eval<string>("localStorage.getItem('visitCount')")).toBe("1")
    await d1.close()
  }, 15000)

  test("userDataDir persists profile across launches", async () => {
    const d2 = await launch(`http://127.0.0.1:${PORT}/`, { userDataDir: profile })
    // Same on-disk profile ⇒ localStorage survived ⇒ the page's increment
    // brings visitCount to 2.
    expect(await d2.eval<string>("localStorage.getItem('visitCount')")).toBe("2")
    await d2.close()
  }, 15000)

  test("omitting userDataDir gives a fresh profile", async () => {
    const d3 = await launch(`http://127.0.0.1:${PORT}/`)
    expect(await d3.eval<string>("localStorage.getItem('visitCount')")).toBe("1")
    await d3.close()
  }, 15000)
})
