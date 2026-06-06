import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { extractEcho, extractModeline } from "./screen"

const DRIVE = resolve(import.meta.dir, "../../scripts/emacs-drive.sh")
let counter = 0

function sh(args: string[], session: string): string {
  const r = spawnSync(DRIVE, args, {
    env: { ...process.env, EMACS_DRIVE_SESSION: session },
    encoding: "utf8",
  })
  if (r.status !== 0 && args[0] !== "stop") {
    throw new Error(`emacs-drive ${args.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`)
  }
  return r.stdout
}

/** Drive Stephen's Emacs in tmux; returns screen capture and echo line. */
export async function emacsProbe(opts: {
  file?: string
  keys: string[]
  waitFor?: string
}): Promise<{ screen: string; modeline: string; echo: string }> {
  const session = `je${process.pid}-${counter++}`
  try {
    sh(["start", ...(opts.file ? [opts.file] : [])], session)
    if (opts.file) sh(["wait", "\\(Markdown|\\.md", "12"], session)
    if (opts.keys.length) sh(["keys", ...opts.keys], session)
    if (opts.waitFor) sh(["wait", opts.waitFor, "10"], session)
    const screen = sh(["cap"], session)
    return {
      screen,
      modeline: extractModeline(screen),
      echo: extractEcho(screen),
    }
  } finally {
    sh(["stop"], session)
  }
}
