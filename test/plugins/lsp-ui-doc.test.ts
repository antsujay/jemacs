import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { makeEditor } from "./helper"
import { BufferModel } from "../../src/kernel/buffer"
import { LspManager } from "../../src/lsp/manager"
import { bufferUri } from "../../src/lsp/positions"
import type { LspWorkspace } from "../../src/lsp/workspace"
import { setCustom } from "../../src/runtime/custom"
import { createPluginContext } from "../../src/runtime/plugin-context"
import { install, lspUiDocHide, lspUiDocShow } from "../../plugins/lsp-ui-doc"

type Handler = (method: string, params: unknown) => unknown

function fakeWorkspace(handler: Handler): { ws: LspWorkspace; calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = []
  const ws: LspWorkspace = {
    root: "/proj",
    client: {
      serverId: "fake",
      majorModes: ["typescript"],
      priority: 0,
      languageId: () => "typescript",
      newConnection: { connect: () => ({ send: () => {}, proc: { kill: () => {} } }) },
    },
    status: "initialized",
    buffers: [],
    openedUris: new Set(),
    serverCapabilities: { hoverProvider: true },
    diagnosticsByPath: new Map(),
    rpc: {
      sendNotification: () => {},
      request: async (method, params) => {
        calls.push({ method, params })
        return handler(method, params)
      },
      requestAsync: () => 0,
      dispose: () => {},
    },
    send: () => {},
    kill: () => {},
    uriForBuffer: b => bufferUri(b) ?? "",
  }
  return { ws, calls }
}

function setup(handler: Handler) {
  const editor = makeEditor()
  const ctx = createPluginContext(editor)
  install(editor, ctx)
  const manager = new LspManager(editor)
  editor.lsp = manager
  const path = resolve("/proj/a.ts")
  const buffer = new BufferModel({ name: "a.ts", path, text: "const foo = 1\n", mode: "typescript" })
  editor.addBuffer(buffer)
  editor.switchToBuffer(buffer.id)
  const { ws, calls } = fakeWorkspace(handler)
  manager.enableLspMode(buffer, [ws])
  return { editor, buffer, calls, dispose: () => ctx.dispose() }
}

test("lsp-ui-doc-show displays LSP hover in a child frame", async () => {
  const { editor, buffer, calls, dispose } = setup(method =>
    method === "textDocument/hover" ? { contents: { kind: "markdown", value: "const foo: 1\n\nDocs." } } : null,
  )
  try {
    setCustom("lsp-ui-doc-enable", true)
    buffer.point = buffer.text.indexOf("foo")
    const doc = await lspUiDocShow(editor)

    expect(doc).toContain("const foo: 1")
    expect(calls.find(c => c.method === "textDocument/hover")).toBeDefined()
    const docBuffer = [...editor.buffers.values()].find(b => b.name === "*lsp-ui-doc*")
    expect(docBuffer).toBeDefined()
    expect(docBuffer?.text).toContain("Docs.")
    expect(editor.childFrames.size).toBe(1)
    expect([...editor.childFrames.values()][0]!.window.bufferId).toBe(docBuffer!.id)
  } finally {
    setCustom("lsp-ui-doc-enable", false)
    dispose()
  }
})

test("lsp-ui-doc-hide hides the active child frame", async () => {
  const { editor, dispose } = setup(method =>
    method === "textDocument/hover" ? { contents: "hover" } : null,
  )
  try {
    await editor.run("lsp-ui-doc-show")
    const frame = [...editor.childFrames.values()][0]
    expect(frame?.visible).toBe(true)
    lspUiDocHide(editor)
    expect(frame?.visible).toBe(false)
  } finally {
    dispose()
  }
})
