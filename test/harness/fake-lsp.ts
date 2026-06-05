import type { LspClient, LspConnection } from "../../src/lsp/client"
import { LspMessageParser, serializeMessage, type JsonRpcMessage } from "../../src/lsp/transport"

export type FakeLspServer = {
  /** Register this as the client's `newConnection`. */
  connection: LspConnection
  /** Every message the editor sent, parsed. Newest last. */
  sent: JsonRpcMessage[]
  /** Filtered view of `sent` by method (notifications + requests). */
  sentBy(method: string): JsonRpcMessage[]
  /** Last request id seen, for `respond()`. */
  lastRequestId(): number | string | null
  /** Send a response to a pending request. */
  respond(id: number | string, result: unknown): void
  /** Send a server→client notification. */
  notify(method: string, params: unknown): void
  /** Feed raw bytes through the *real* parser path (for transport-layer bugs). */
  feedRaw(bytes: Uint8Array | string): void
  /** Simulate process exit. */
  exit(code?: number): void
  alive: boolean
}

export function fakeLspServer(): FakeLspServer {
  const sent: JsonRpcMessage[] = []
  let onData: ((chunk: string) => void) | null = null
  let onExit: ((code: number | null) => void) | null = null
  let alive = false
  // Editor → server: parse what the editor wrote.
  const inParser = new LspMessageParser()

  const connection: LspConnection = {
    connect(args) {
      onData = args.onData
      onExit = args.onExit
      alive = true
      return {
        proc: { kill: () => { alive = false; onExit?.(null) } },
        send: payload => { for (const m of inParser.feed(payload)) sent.push(m) },
      }
    },
  }

  return {
    connection,
    sent,
    sentBy: method => sent.filter(m => m.method === method),
    lastRequestId: () => [...sent].reverse().find(m => m.id != null && m.method != null)?.id ?? null,
    respond: (id, result) => onData?.(serializeMessage({ jsonrpc: "2.0", id, result })),
    notify: (method, params) => onData?.(serializeMessage({ jsonrpc: "2.0", method, params })),
    feedRaw: bytes => onData?.(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes)),
    exit: code => { alive = false; onExit?.(code ?? 0) },
    get alive() { return alive },
  }
}

/** Minimal LspClient backed by `server`, attaching to the given modes. */
export function fakeLspClient(server: FakeLspServer, opts?: { modes?: string[]; serverId?: string }): LspClient {
  return {
    serverId: opts?.serverId ?? "fake-ls",
    majorModes: opts?.modes ?? ["typescript", "javascript"],
    priority: 100,
    languageId: () => "typescript",
    newConnection: server.connection,
  }
}
