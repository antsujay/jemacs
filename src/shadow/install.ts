/**
 * Self-install over ssh — DESIGN.md §Self-install. `shadow-connect ssh://host`
 * calls `ensureRemote(host)` before `spawnStdioLink`: probe for a matching
 * `~/.jemacs/bin/jemacs-$REV`, and if absent ship the local bundle + bun.
 * $REV pins client and server to the same protocol so a mismatch is impossible.
 */

import { spawn } from "node:child_process"
import { createReadStream, existsSync } from "node:fs"
import { join } from "node:path"
import type { Editor } from "../kernel/editor"
import { announceBuffer, authorityState, shadowState } from "./shadow"

/** Result of one subprocess invocation. */
export type RunResult = { code: number; stdout: string; stderr: string }
export type RunOpts = { stdinFile?: string }
/** Spawn `argv[0]` with `argv[1..]` and resolve once it exits. Never rejects. */
export type Run = (argv: string[], opts?: RunOpts) => Promise<RunResult>

export type InstallOpts = {
  /** Override the protocol revision; defaults to `jemacsRev()`. */
  rev?: string
  /** Local bundle tarball; defaults to `dist/jemacs-$REV.tar.gz` (built by `scripts/bundle.sh`). */
  bundle?: string
  /** Subprocess runner — injected by tests so no real ssh is needed. */
  run?: Run
  /** Progress sink (e.g. `editor.message`). */
  log?: (msg: string) => void
}

const JEMACS_ROOT = join(import.meta.dirname, "..", "..")

/** Default `Run`: `child_process.spawn` with stdio captured. */
export const realRun: Run = (argv, opts) =>
  new Promise(resolve => {
    const stdin = opts?.stdinFile ? createReadStream(opts.stdinFile) : "ignore"
    const proc = spawn(argv[0]!, argv.slice(1), { stdio: [stdin === "ignore" ? "ignore" : "pipe", "pipe", "pipe"] })
    if (stdin !== "ignore") stdin.pipe(proc.stdin!)
    let stdout = "", stderr = ""
    proc.stdout.on("data", c => { stdout += c })
    proc.stderr.on("data", c => { stderr += c })
    proc.on("close", code => resolve({ code: code ?? -1, stdout, stderr }))
    proc.on("error", e => resolve({ code: -1, stdout, stderr: stderr + String(e) }))
  })

let cachedRev: string | undefined

/** Short rev identifying this build's protocol. `JEMACS_REV` (baked in by
 *  `scripts/bundle.sh`) wins; otherwise `git rev-parse --short HEAD`. */
export function jemacsRev(): string {
  if (process.env.JEMACS_REV) return process.env.JEMACS_REV
  if (cachedRev) return cachedRev
  // Sync is fine here: called once at connect time, not in any hot path.
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process")
  const r = spawnSync("git", ["-C", JEMACS_ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" })
  cachedRev = r.status === 0 ? r.stdout.trim() : "dev"
  return cachedRev
}

/** Same `user@host[:port]` gate as `parseConnectTarget` — anything else could
 *  become an ssh option or shell metachar. */
export function validateHost(host: string): string {
  if (!/^[A-Za-z0-9._@:-]+$/.test(host) || host.startsWith("-")) {
    throw new Error(`shadow-install: invalid host '${host}'`)
  }
  return host
}

/** `rev` lands in remote shell strings — only allow git-sha/semver-ish. */
export function validateRev(rev: string): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(rev)) {
    throw new Error(`shadow-install: invalid rev '${String(rev).slice(0, 80)}'`)
  }
  return rev
}

/** Remote install dir for `rev` (literal `~` — expanded by the remote shell). */
export function remoteDir(rev: string): string {
  return `~/.jemacs/bin/jemacs-${validateRev(rev)}`
}

/** Local bundle path `scripts/bundle.sh` writes for `rev`. */
export function bundlePath(rev: string): string {
  return join(JEMACS_ROOT, "dist", `jemacs-${rev}.tar.gz`)
}

/** argv for the post-install `StdioLink` spawn (DESIGN.md step 4). */
export function sshServeArgv(host: string, rev = jemacsRev()): string[] {
  return ["ssh", "--", validateHost(host), `${remoteDir(rev)}/jemacs`, "--serve-stdio"]
}

/** True iff the version-pinned launcher already exists on `host`. */
export async function probeRemote(host: string, opts: InstallOpts = {}): Promise<boolean> {
  const rev = opts.rev ?? jemacsRev()
  const run = opts.run ?? realRun
  const r = await run(["ssh", "--", validateHost(host), `test -x ${remoteDir(rev)}/jemacs`])
  return r.code === 0
}

/** True iff `bun` resolves on the remote's login-shell PATH. */
export async function probeBun(host: string, opts: InstallOpts = {}): Promise<boolean> {
  const run = opts.run ?? realRun
  // ~/.bun/bin isn't on PATH until the next login after install.sh, so check it explicitly.
  const r = await run(["ssh", "--", validateHost(host), "command -v bun || test -x ~/.bun/bin/bun"])
  return r.code === 0
}

/**
 * Ensure `~/.jemacs/bin/jemacs-$REV/jemacs` exists on `host`, installing bun
 * and shipping the bundle if not. Returns the argv to hand `spawnStdioLink`.
 *
 * Idempotent: a second call with the same rev is one ssh round-trip (the probe).
 */
export async function ensureRemote(host: string, opts: InstallOpts = {}): Promise<string[]> {
  validateHost(host)
  const rev = opts.rev ?? jemacsRev()
  const run = opts.run ?? realRun
  const log = opts.log ?? (() => {})

  if (await probeRemote(host, { ...opts, rev })) {
    log(`[shadow] ${host}: jemacs-${rev} present`)
    return sshServeArgv(host, rev)
  }

  // Bun first so the launcher works once the tarball lands.
  if (!await probeBun(host, opts)) {
    log(`[shadow] ${host}: installing bun…`)
    const r = await run(["ssh", "--", host, "curl -fsSL https://bun.sh/install | bash"])
    if (r.code !== 0) throw new Error(`shadow-install: bun install failed on ${host}: ${r.stderr.trim()}`)
  }

  const bundle = opts.bundle ?? bundlePath(rev)
  if (!opts.bundle && !existsSync(bundle)) {
    log(`[shadow] building bundle ${bundle}…`)
    const r = await run([join(JEMACS_ROOT, "scripts", "bundle.sh")])
    if (r.code !== 0) throw new Error(`shadow-install: bundle.sh failed: ${r.stderr.trim()}`)
  }

  log(`[shadow] ${host}: shipping jemacs-${rev}…`)
  const dir = remoteDir(rev)
  // Stream the tarball over ssh's stdin (no local sh -c, no remote tmpfile).
  // dir is validateRev'd; the remote command is a fixed string with that one
  // pre-validated component, passed as a single ssh argv element.
  const stream = await run(
    ["ssh", "--", host, `mkdir -p ${dir} && tar xzf - -C ${dir}`],
    { stdinFile: bundle },
  )
  if (stream.code !== 0) throw new Error(`shadow-install: upload to ${host} failed: ${stream.stderr.trim()}`)

  log(`[shadow] ${host}: jemacs-${rev} installed`)
  return sshServeArgv(host, rev)
}

// ── Initial state sync (DESIGN.md §Ops / qa-shadow.ts step 1) ──────────────
//
// `attachAuthority` wires the live op stream but ships nothing about A's
// *current* state — which buffers are open, which one is selected. host.ts
// announced every buffer by hand, but S still sat on its own *scratch* because
// no op said "this is the one A is showing". `initialSync` is that handshake:
// the same call on both sides, role-dispatched on authorityState/shadowState.

/** Builtin buffers both editors create in their constructor — not announced
 *  (S already has its own) and never auto-selected. */
function isBuiltin(kind: string): boolean {
  return kind === "scratch" || kind === "messages" || kind === "minibuffer"
}

/**
 * Authority side: announce A's open buffers — `currentBuffer` first so S's
 * auto-select hook (below) lands on it — then ship the window layout so a
 * layout-aware S can mirror splits once `applyRemoteOp` grows that handler.
 *
 * Shadow side: hook `onAddBuffer` to `switchToBuffer` the first non-builtin
 * buffer that arrives over the link. `attachShadow` doesn't claim
 * `onAddBuffer` (only `attachAuthority` does), so chaining is safe.
 *
 * Returns an unhook (no-op on the authority side).
 */
export function initialSync(editor: Editor): () => void {
  const auth = authorityState(editor)
  if (auth) {
    const cur = editor.currentBuffer
    if (!isBuiltin(cur.kind)) announceBuffer(editor, cur.id)
    for (const buf of editor.buffers.values()) {
      if (buf.id === cur.id || isBuiltin(buf.kind)) continue
      announceBuffer(editor, buf.id)
    }
    auth.link.send({ kind: "layout", tree: editor.windowLayout })
    return () => {}
  }
  if (shadowState(editor)) {
    const prev = editor.onAddBuffer
    let switched = false
    editor.onAddBuffer = buf => {
      prev?.(buf)
      if (switched || isBuiltin(buf.kind)) return
      switched = true
      editor.switchToBuffer(buf.id)
    }
    return () => { editor.onAddBuffer = prev }
  }
  return () => {}
}
