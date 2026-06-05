/** Content-Length JSON-RPC transport (lsp--make-message, lsp--create-filter-function). */

import type { LSPAny } from "vscode-languageserver-types"

export type JsonRpcMessage = {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: LSPAny
  result?: LSPAny
  error?: { code?: number; message?: string; data?: LSPAny }
}

export type MessageKind = "request" | "response" | "response-error" | "notification"

export function makeNotification(method: string, params?: LSPAny): JsonRpcMessage {
  return { jsonrpc: "2.0", method, params }
}

export function makeRequest(method: string, params: LSPAny, id: number): JsonRpcMessage {
  return { jsonrpc: "2.0", id, method, params }
}

export function makeResponse(id: number | string, result: LSPAny): JsonRpcMessage {
  return { jsonrpc: "2.0", id, result }
}

export function serializeMessage(message: JsonRpcMessage): string {
  const body = JSON.stringify(message)
  const bytes = new TextEncoder().encode(body).byteLength
  return `Content-Length: ${bytes}\r\n\r\n${body}`
}

export function messageKind(data: JsonRpcMessage): MessageKind {
  if (data.error != null) return "response-error"
  if (data.id != null && (data.result !== undefined || data.error !== undefined)) {
    return data.error ? "response-error" : "response"
  }
  if (data.method) return data.id == null ? "notification" : "request"
  return "notification"
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function indexOfCrlfCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i
  }
  return -1
}

/** Incremental parser matching lsp--create-filter-function. */
export class LspMessageParser {
  private bodyLength: number | null = null
  private bodyReceived = 0
  private bodyChunks: Uint8Array[] = []
  private leftovers = new Uint8Array(0)

  feed(chunk: string): JsonRpcMessage[] {
    // Content-Length counts UTF-8 bytes, so slice on bytes — not UTF-16 code units.
    let bytes = this.leftovers.length
      ? concatBytes(this.leftovers, new TextEncoder().encode(chunk))
      : new TextEncoder().encode(chunk)
    this.leftovers = new Uint8Array(0)
    const messages: JsonRpcMessage[] = []

    while (bytes.length > 0) {
      if (this.bodyLength == null) {
        const sep = indexOfCrlfCrlf(bytes)
        if (sep === -1) {
          this.leftovers = bytes
          break
        }
        const headerBlock = new TextDecoder().decode(bytes.subarray(0, sep))
        const match = headerBlock.match(/Content-Length:\s*(\d+)/i)
        if (!match) throw new Error("Unable to find Content-Length header")
        this.bodyLength = Number(match[1])
        this.bodyReceived = 0
        this.bodyChunks = []
        bytes = bytes.subarray(sep + 4)
        continue
      }

      const left = this.bodyLength - this.bodyReceived
      const take = bytes.subarray(0, left)
      this.bodyChunks.push(take)
      this.bodyReceived += take.length
      bytes = bytes.subarray(take.length)

      if (this.bodyReceived >= this.bodyLength) {
        const body = new TextDecoder().decode(concatBytes(...this.bodyChunks))
        this.bodyLength = null
        this.bodyReceived = 0
        this.bodyChunks = []
        try {
          messages.push(JSON.parse(body) as JsonRpcMessage)
        } catch (error) {
          throw new Error(`Failed to parse LSP JSON: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    return messages
  }
}
