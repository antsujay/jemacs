// Cap concurrent tui sessions and force-kill stale ones before each probe.
import { spawnSync } from "node:child_process"
let live = 0
export function guardTui(): void {
  if (live === 0) {
    // Reap any sessions from a prior crashed run before starting.
    spawnSync("sh", ["-c", "tmux ls 2>/dev/null | grep -E '^jt' | cut -d: -f1 | xargs -rn1 tmux kill-session -t 2>/dev/null"])
  }
  live++
}
export function releaseTui(): void { live = Math.max(0, live - 1) }
process.on("exit", () => spawnSync("sh", ["-c", "tmux ls 2>/dev/null | grep -E '^jt' | cut -d: -f1 | xargs -rn1 tmux kill-session -t 2>/dev/null"]))
