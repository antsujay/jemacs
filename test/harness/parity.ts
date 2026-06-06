import { copyFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emacsProbe } from "./emacs"
import { tuiProbe } from "./tui"

/** Normalize markdown buffer text for Emacs vs Jemacs comparison. */
export function normalizeMarkdownBuffer(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  while (lines.length && lines.at(-1) === "") lines.pop()
  return lines.map(l => l.replace(/\s+$/, "")).join("\n")
}

function scratchCopy(fixturePath: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const dest = join(dir, "doc.md")
  copyFileSync(fixturePath, dest)
  return dest
}

/** Run the same key sequence in Jemacs and Emacs (tmux), save, return file bodies. */
export async function driveParity(opts: {
  fixture: string
  keys: string[]
  waitFor?: string
  save?: boolean
}): Promise<{ jemacs: string; emacs: string; jemacsEcho: string; emacsEcho: string }> {
  const jpath = scratchCopy(opts.fixture, "jemacs-parity-")
  const epath = scratchCopy(opts.fixture, "emacs-parity-")
  const saveKeys = opts.save === false ? [] : ["C-x", "C-s"]
  const keys = [...opts.keys, ...saveKeys]

  await tuiProbe({ file: jpath, keys, waitFor: opts.waitFor })
  await emacsProbe({ file: epath, keys, waitFor: opts.waitFor })

  return {
    jemacs: readFileSync(jpath, "utf8"),
    emacs: readFileSync(epath, "utf8"),
    jemacsEcho: "",
    emacsEcho: "",
  }
}

/** Keys + screen echo capture without save (for FOLDED etc.). */
export async function echoParity(opts: {
  fixture: string
  keys: string[]
  waitFor?: string
}): Promise<{ jemacsEcho: string; emacsEcho: string }> {
  const jpath = scratchCopy(opts.fixture, "jemacs-echo-")
  const epath = scratchCopy(opts.fixture, "emacs-echo-")
  const j = await tuiProbe({ file: jpath, keys: opts.keys, waitFor: opts.waitFor })
  const e = await emacsProbe({ file: epath, keys: opts.keys, waitFor: opts.waitFor })
  return { jemacsEcho: j.echo, emacsEcho: e.echo }
}
