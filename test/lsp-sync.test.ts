import { expect, test } from "bun:test"
import { BufferModel } from "../src/kernel/buffer"
import { bufferUri } from "../src/lsp/positions"
import { textDocumentDidOpen } from "../src/lsp/sync"
import type { LspWorkspace } from "../src/lsp/workspace"

test("textDocumentDidOpen is sent once per URI when enabling LSP on a buffer", () => {
  const notifications: Array<{ method: string; params: unknown }> = []
  const workspace: LspWorkspace = {
    root: "/proj",
    client: { serverId: "test", priority: 0, newConnection: { connect: () => ({ send: () => {}, proc: { kill: () => {} } }) } } as LspWorkspace["client"],
    status: "initialized",
    buffers: [],
    openedUris: new Set(),
    serverCapabilities: null,
    diagnosticsByPath: new Map(),
    rpc: {
      sendNotification(method, params) {
        notifications.push({ method, params })
      },
      request: async () => ({}),
      requestAsync: () => 0,
      dispose: () => {},
    },
    send: () => {},
    kill: () => {},
    uriForBuffer: buffer => bufferUri(buffer) ?? "",
  }
  const buffer = new BufferModel({ name: "b.ts", path: "/proj/b.ts", text: "const x = 1\n", mode: "typescript" })

  textDocumentDidOpen(workspace, buffer)
  textDocumentDidOpen(workspace, buffer)

  const uri = bufferUri(buffer)!
  expect(workspace.openedUris.has(uri)).toBe(true)
  expect(notifications).toHaveLength(1)
  expect(notifications[0]?.method).toBe("textDocument/didOpen")
})
