/**
 * `ShadowLink` over a byte stream (subprocess pipes, ssh, process.stdin/stdout)
 * using the same Content-Length JSON framing as LSP — DESIGN.md §Transport.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { LspMessageParser, serializeMessage, type JsonRpcMessage } from "../lsp/transport"
import type { ShadowLink, ShadowRole } from "./link"
import type { ShadowOp } from "./ops"

/** Minimal duck types so the same StdioLink covers `process.stdin/stdout`,
 *  child_process pipes, and a `net.Socket`. */
export type ByteSource = {
  on(event: "data", fn: (chunk: Buffer | string) => void): unknown
  on(event: "end" | "close", fn: () => void): unknown
  destroy?(): void
}
export type ByteSink = {
  write(chunk: string): unknown
  end?(): void
}

export type StdioLinkOpts = {
  peerId?: string
  role: ShadowRole
  trust?: "full" | "propose"
  /** Called once when the input stream ends or `close()` is invoked. */
  onClose?: () => void
}

export class StdioLink implements ShadowLink {
  readonly peerId: string
  readonly role: ShadowRole
  readonly trust: "full" | "propose"

  private handler: ((op: ShadowOp) => void) | undefined
  /** Ops parsed before `on()` was called — flushed when the handler arrives. */
  private readonly buffered: ShadowOp[] = []
  private readonly parser = new LspMessageParser()
  private readonly decoder = new TextDecoder("utf-8")
  private closed = false
  private readonly onClose?: () => void

  constructor(
    private readonly input: ByteSource,
    private readonly output: ByteSink,
    opts: StdioLinkOpts,
  ) {
    this.peerId = opts.peerId ?? `stdio-${Math.random().toString(36).slice(2, 8)}`
    this.role = opts.role
    this.trust = opts.trust ?? "full"
    this.onClose = opts.onClose

    input.on("data", chunk => {
      if (this.closed) return
      // stream:true so a UTF-8 char split across chunk boundaries is held, not
      // replaced — LspMessageParser re-encodes to bytes for Content-Length.
      const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true })
      for (const msg of this.parser.feed(text)) this.dispatch(msg as unknown as ShadowOp)
    })
    input.on("end", () => this.close())
    input.on("close", () => this.close())
  }

  private dispatch(op: ShadowOp): void {
    if (this.handler) this.handler(op)
    else this.buffered.push(op)
  }

  send(op: ShadowOp): void {
    if (this.closed) return
    // serializeMessage just JSON.stringify + Content-Length; the JsonRpcMessage
    // typing is incidental — any JSON-serializable value frames identically.
    this.output.write(serializeMessage(op as unknown as JsonRpcMessage))
  }

  on(handler: (op: ShadowOp) => void): void {
    this.handler = handler
    while (this.buffered.length) handler(this.buffered.shift()!)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try { this.output.end?.() } catch { /* already closed */ }
    try { this.input.destroy?.() } catch { /* already closed */ }
    this.onClose?.()
  }
}

/**
 * Spawn `cmd` and return a shadow-role StdioLink wired to its stdin/stdout.
 * stderr is forwarded to this process's stderr so framing on stdout stays clean.
 * Closing the link kills the child.
 */
export function spawnStdioLink(cmd: string[], opts: Omit<StdioLinkOpts, "role"> = {}): StdioLink {
  if (cmd.length === 0) throw new Error("spawnStdioLink: empty command")
  const proc: ChildProcess = spawn(cmd[0]!, cmd.slice(1), {
    stdio: ["pipe", "pipe", "inherit"],
  })
  const link = new StdioLink(proc.stdout!, proc.stdin!, {
    ...opts,
    role: "shadow",
    peerId: opts.peerId ?? cmd.join(" "),
    onClose: () => {
      opts.onClose?.()
      try { proc.kill() } catch { /* already dead */ }
    },
  })
  proc.on("exit", () => link.close())
  return link
}

/** Parse a `shadow-connect` URI into the argv to hand `spawnStdioLink`. */
export function parseConnectTarget(target: string): string[] {
  if (target.startsWith("stdio:")) {
    // Shell-ish split is enough here; quoting can come later with the self-install work.
    return target.slice("stdio:".length).trim().split(/\s+/).filter(Boolean)
  }
  if (target.startsWith("ssh://")) {
    const rest = target.slice("ssh://".length)
    const slash = rest.indexOf("/")
    const host = slash === -1 ? rest : rest.slice(0, slash)
    // user@host[:port] only — anything else (leading -, spaces, ;) could become an ssh option.
    if (!/^[A-Za-z0-9._@:-]+$/.test(host) || host.startsWith("-")) {
      throw new Error(`shadow-connect: invalid host '${host}'`)
    }
    // Version-pinned remote path per DESIGN.md §Self-install; bootstrap is a TODO.
    return ["ssh", "--", host, "~/.jemacs/bin/jemacs", "--serve-stdio"]
  }
  throw new Error(`shadow-connect: unsupported target '${target}' (want ssh://host or stdio:CMD)`)
}
