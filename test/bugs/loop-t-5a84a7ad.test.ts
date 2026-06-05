import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const DRIVE = resolve(import.meta.dir, "../../scripts/tui-drive.sh")

// t-5a84a7ad: `tui-drive.sh keys 'ls' Space '-la'` → tmux: unknown flag -a.
// The literal branch ran `tmux send-keys -t S -l "$k"` with no `--`, so any
// arg starting with '-' was parsed as tmux flags. Blocks driving CLI flags
// through term.
test("tui-drive.sh keys: literal args starting with '-' are sent verbatim", () => {
  const session = `jt-5a84a7ad-${process.pid}`
  const env = { ...process.env, JEMACS_TMUX_SESSION: session }
  // Bare session running cat so typed bytes echo into the pane.
  spawnSync("tmux", ["kill-session", "-t", session], { env })
  spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "80", "-y", "5", "cat"], { env })
  try {
    const r = spawnSync(DRIVE, ["keys", "ls", "Space", "-la"], { env, encoding: "utf8" })
    expect(r.stderr).not.toMatch(/unknown/)
    expect(r.status).toBe(0)
    const cap = spawnSync("tmux", ["capture-pane", "-t", session, "-p"], { env, encoding: "utf8" })
    expect(cap.stdout).toContain("ls -la")
  } finally {
    spawnSync("tmux", ["kill-session", "-t", session], { env })
  }
})
