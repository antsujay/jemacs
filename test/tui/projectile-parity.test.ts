import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { extractEcho } from "../harness/screen"

const TIMEOUT = 45000
const SKIP = !!process.env.JEMACS_SKIP_TUI || !!process.env.CI || !process.env.JEMACS_PARITY_EMACS
const TUI_DRIVE = resolve(import.meta.dir, "../../scripts/tui-drive.sh")
const EMACS_DRIVE = resolve(import.meta.dir, "../../scripts/emacs-drive.sh")

function drive(
  script: string,
  session: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): string {
  const r = spawnSync(script, args, {
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  })
  if (r.status !== 0 && args[0] !== "stop") {
    throw new Error(`${script} ${args.join(" ")} failed: ${r.stderr || r.stdout}`)
  }
  return r.stdout
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "proj-parity-"))
  const repo = join(dir, "repo")
  await mkdir(join(repo, "src"), { recursive: true })
  await writeFile(join(repo, "README.md"), "# parity\n")
  await writeFile(join(repo, "src", "main.ts"), "export {}\n")
  spawnSync("git", ["init", "-q"], { cwd: repo })
  spawnSync("git", ["add", "."], { cwd: repo })
  return join(repo, "README.md")
}

function emacsProbe(
  session: string,
  file: string,
  keys: string[],
  promptRe: string,
): { screen: string; echo: string } {
  const env = { EMACS_DRIVE_SESSION: session }
  drive(EMACS_DRIVE, session, ["stop"], env)
  drive(EMACS_DRIVE, session, ["start", file], env)
  drive(EMACS_DRIVE, session, ["wait", "README|Markdown", "25"], env)
  if (keys.length) drive(EMACS_DRIVE, session, ["keys", ...keys], env)
  drive(EMACS_DRIVE, session, ["wait", promptRe, "12"], env)
  const screen = drive(EMACS_DRIVE, session, ["cap"], env)
  drive(EMACS_DRIVE, session, ["stop"], env)
  return { screen, echo: extractEcho(screen) }
}

describe.skipIf(SKIP)("projectile parity: jemacs vs Emacs (tmux)", () => {
  test("C-c p f opens Find file prompt", async () => {
    const file = await makeRepo()
    const cfg = resolve(import.meta.dir, "../fixtures/projectile-config.ts")
    drive(TUI_DRIVE, "jp-parity-f", ["stop"], { JEMACS_TMUX_SESSION: "jp-parity-f" })
    const jEnv = { JEMACS_TMUX_SESSION: "jp-parity-f", JEMACS_HOME: resolve(import.meta.dir, "../..") }
    drive(TUI_DRIVE, "jp-parity-f", ["start", "--config", cfg, file], jEnv)
    drive(TUI_DRIVE, "jp-parity-f", ["wait", "README", "15"], jEnv)
    drive(TUI_DRIVE, "jp-parity-f", ["keys", "C-c", "p", "f"], jEnv)
    drive(TUI_DRIVE, "jp-parity-f", ["wait", "Find file", "10"], jEnv)
    const jScreen = drive(TUI_DRIVE, "jp-parity-f", ["cap"], jEnv)
    drive(TUI_DRIVE, "jp-parity-f", ["stop"], jEnv)
    const j = { screen: jScreen, echo: extractEcho(jScreen) }
    const e = emacsProbe("je-parity-f", file, ["C-c", "p", "f"], "Find file")

    expect(j.echo + j.screen).toMatch(/Find file:/i)
    expect(e.echo + e.screen).toMatch(/Find file:/i)
    expect(j.screen).toMatch(/Projectile/i)
  }, TIMEOUT)

  test("C-c p p opens Switch to project prompt", async () => {
    const file = await makeRepo()
    const cfg = resolve(import.meta.dir, "../fixtures/projectile-config.ts")
    const jEnv = { JEMACS_TMUX_SESSION: "jp-parity-p", JEMACS_HOME: resolve(import.meta.dir, "../..") }
    drive(TUI_DRIVE, "jp-parity-p", ["stop"], jEnv)
    drive(TUI_DRIVE, "jp-parity-p", ["start", "--config", cfg, file], jEnv)
    drive(TUI_DRIVE, "jp-parity-p", ["wait", "README", "15"], jEnv)
    drive(TUI_DRIVE, "jp-parity-p", ["keys", "C-c", "p", "p"], jEnv)
    drive(TUI_DRIVE, "jp-parity-p", ["wait", "Switch to project", "10"], jEnv)
    const jScreen = drive(TUI_DRIVE, "jp-parity-p", ["cap"], jEnv)
    drive(TUI_DRIVE, "jp-parity-p", ["stop"], jEnv)
    const j = { screen: jScreen, echo: extractEcho(jScreen) }
    const e = emacsProbe("je-parity-p", file, ["C-c", "p", "p"], "Switch to project")

    expect(j.echo + j.screen).toMatch(/Switch to project:/i)
    expect(e.echo + e.screen).toMatch(/Switch to project:/i)
  }, TIMEOUT)
})
