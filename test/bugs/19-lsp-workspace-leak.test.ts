import { test, expect } from "bun:test"
import { fakeLspServer, fakeLspClient } from "../harness"
import { Editor } from "../../src/kernel/editor"
import { LspManager } from "../../src/lsp/manager"
import { startWorkspace } from "../../src/lsp/workspace"

test("shutdownWorkspaceCmd prunes manager.workspaces", async () => {
  const editor = new Editor()
  const manager = (editor.lsp = new LspManager(editor))
  editor.currentBuffer.path = "/proj/a.ts"
  const server = fakeLspServer()
  const starting = startWorkspace(fakeLspClient(server), "/proj", [editor.currentBuffer])
  server.respond(server.lastRequestId()!, { capabilities: {} })
  const ws = await starting
  manager.workspaces.push(ws)
  manager.enableLspMode(editor.currentBuffer, [ws])
  const shutting = manager.shutdownWorkspaceCmd()
  server.respond(server.lastRequestId()!, null)
  await shutting
  expect(manager.workspaces).toHaveLength(0)
})
