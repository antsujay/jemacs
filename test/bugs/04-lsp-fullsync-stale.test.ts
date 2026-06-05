import { expect, test } from "bun:test"
import { fakeLspServer, fakeLspClient } from "../harness"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { LspManager } from "../../src/lsp/manager"
import { startWorkspace } from "../../src/lsp/workspace"

test("full-sync didChange sends post-change text on first insert", async () => {
  const server = fakeLspServer()
  const buffer = new BufferModel({ name: "a.ts", path: "/a.ts", text: "", mode: "typescript" })
  const manager = new LspManager(new Editor())
  const wsP = startWorkspace(fakeLspClient(server), "/", [buffer])
  server.respond(server.lastRequestId()!, { capabilities: {} })
  manager.attachBuffer(buffer)
  manager.enableLspMode(buffer, [await wsP])
  buffer.insert("a")
  const change = server.sentBy("textDocument/didChange")[0]!.params as any
  expect(change.contentChanges[0].text).toBe("a")
})
