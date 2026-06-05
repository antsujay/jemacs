import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const DRIVE = resolve(import.meta.dir, "../../scripts/tui-drive.sh")

// t-a3304919: tmux treats a trailing ';' on an argv element as a command
// separator (`--` does not suppress this), so `keys 'M-;'` arrived as `M-`
// typed literally and a bare `;` key (needed for the C-c ; chord) vanished.
test("tui-drive.sh keys: ';' chords reach the pane intact", () => {
  const session = `jt-a3304919-${process.pid}`
  const env = { ...process.env, JEMACS_TMUX_SESSION: session }
  spawnSync("tmux", ["kill-session", "-t", session], { env })
  // cat -v echoes typed bytes with ESC visible as ^[.
  spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "80", "-y", "5", "cat -v"], { env })
  try {
    const r = spawnSync(DRIVE, ["keys", "M-;", ";", "let x;"], { env, encoding: "utf8" })
    expect(r.status).toBe(0)
    const cap = spawnSync("tmux", ["capture-pane", "-t", session, "-p"], { env, encoding: "utf8" })
    const line = cap.stdout.split("\n")[0]
    expect(line).not.toContain("M-")
    expect(line).toBe("^[;;let x;")
  } finally {
    spawnSync("tmux", ["kill-session", "-t", session], { env })
  }
})
