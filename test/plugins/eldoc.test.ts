import { afterEach, beforeEach, expect, test } from "bun:test"
import { resolve } from "node:path"
import { makeEditor } from "./helper"
import { clearHooks } from "../../src/kernel/hooks"
import { setCustom } from "../../src/runtime/custom"
import { defineMode } from "../../src/modes/mode"
import { BufferModel } from "../../src/kernel/buffer"
import { LspManager } from "../../src/lsp/manager"
import { bufferUri } from "../../src/lsp/positions"
import type { LspWorkspace } from "../../src/lsp/workspace"
import { cancelTimer, install as persistInstall, type Timer } from "../../plugins/persist"
import {
  type EldocFunction,
  eldocPrintCurrentSymbolInfo,
  eldocScheduleTimer,
  install,
  modeEldocFunction,
} from "../../plugins/eldoc"

type Handler = (method: string, params: unknown) => unknown

let timers: Timer[] = []

function track(t: Timer): Timer {
  timers.push(t)
  return t
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

beforeEach(() => {
  clearHooks()
  timers = []
})

afterEach(() => {
  for (const t of timers) cancelTimer(t)
})

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

function setupLsp(handler: Handler) {
  const editor = makeEditor()
  install(editor)
  track(eldocScheduleTimer(editor))
  const manager = new LspManager(editor)
  editor.lsp = manager
  const path = resolve("/proj/a.ts")
  const buffer = new BufferModel({ name: "a.ts", path, text: "const foo = 1\nconsole.log(foo)\n", mode: "typescript" })
  editor.addBuffer(buffer)
  editor.switchToBuffer(buffer.id)
  const { ws, calls } = fakeWorkspace(handler)
  manager.enableLspMode(buffer, [ws])
  let lastMessage = ""
  editor.events.on("message", e => { lastMessage = e.text })
  return { editor, buffer, ws, calls, lastMessage: () => lastMessage }
}

test("install registers commands, defcustom, and enables global-eldoc-mode", () => {
  const editor = makeEditor()
  install(editor)
  track(eldocScheduleTimer(editor))
  expect(editor.commands.get("eldoc-mode")).toBeDefined()
  expect(editor.commands.get("global-eldoc-mode")).toBeDefined()
  expect(editor.commands.get("eldoc")).toBeDefined()
  expect(editor.isMinorModeEnabled("global-eldoc-mode")).toBe(true)
  setCustom("eldoc-idle-delay", 0.5)
})

test("shows first line of LSP hover in echo area", async () => {
  const { editor, buffer, calls, lastMessage } = setupLsp(method => {
    if (method === "textDocument/hover") {
      return { contents: { kind: "markdown", value: "const foo: 1\n\nA constant declaration." } }
    }
    return null
  })
  buffer.point = buffer.text.indexOf("foo")
  const line = await eldocPrintCurrentSymbolInfo(editor)
  expect(line).toBe("const foo: 1")
  expect(lastMessage()).toBe("const foo: 1")
  const call = calls.find(c => c.method === "textDocument/hover")
  expect(call).toBeDefined()
  expect((call!.params as { position: { line: number; character: number } }).position).toEqual({ line: 0, character: 6 })
})

test("falls back to mode.eldocFunction when LSP has nothing", async () => {
  const eldocFunction: EldocFunction = b => `symbol: ${b.symbolBoundsAt().text}`
  defineMode({ name: "eldoc-test-lang", eldocFunction } as Parameters<typeof defineMode>[0])
  const { editor, buffer, lastMessage } = setupLsp(() => null)
  editor.enterMode(buffer, "eldoc-test-lang")
  buffer.point = buffer.text.indexOf("foo")
  const line = await eldocPrintCurrentSymbolInfo(editor)
  expect(line).toBe("symbol: foo")
  expect(lastMessage()).toBe("symbol: foo")
})

test("modeEldocFunction walks parent modes", () => {
  const eldocFunction: EldocFunction = () => "from-parent"
  defineMode({ name: "eldoc-parent", eldocFunction } as Parameters<typeof defineMode>[0])
  defineMode({ name: "eldoc-child", parent: "eldoc-parent" })
  const buffer = new BufferModel({ name: "x", text: "", mode: "eldoc-child" })
  expect(modeEldocFunction(buffer)?.(buffer)).toBe("from-parent")
})

test("uses mode.eldocFunction when no LSP is attached", async () => {
  const editor = makeEditor()
  install(editor)
  track(eldocScheduleTimer(editor))
  const eldocFunction: EldocFunction = () => "doc line one\ndoc line two"
  defineMode({ name: "eldoc-fallback", eldocFunction } as Parameters<typeof defineMode>[0])
  editor.enterMode(editor.currentBuffer, "eldoc-fallback")
  let msg = ""
  editor.events.on("message", e => { msg = e.text })
  const line = await eldocPrintCurrentSymbolInfo(editor)
  expect(line).toBe("doc line one")
  expect(msg).toBe("doc line one")
})

test("does nothing when neither LSP nor eldocFunction is available", async () => {
  const editor = makeEditor()
  install(editor)
  track(eldocScheduleTimer(editor))
  let msg = ""
  editor.events.on("message", e => { msg = e.text })
  const line = await eldocPrintCurrentSymbolInfo(editor)
  expect(line).toBeNull()
  expect(msg).toBe("")
})

test("suppresses repeated identical messages", async () => {
  const { editor, buffer } = setupLsp(method =>
    method === "textDocument/hover" ? { contents: "type Foo = number" } : null,
  )
  buffer.point = buffer.text.indexOf("foo")
  const seen: string[] = []
  editor.events.on("message", e => { seen.push(e.text) })
  await eldocPrintCurrentSymbolInfo(editor)
  await eldocPrintCurrentSymbolInfo(editor)
  expect(seen.filter(m => m === "type Foo = number")).toHaveLength(1)
  expect(buffer.locals.get("eldoc-last-message")).toBe("type Foo = number")
})

test("stays silent while minibuffer is active", async () => {
  const { editor, buffer, calls } = setupLsp(method =>
    method === "textDocument/hover" ? { contents: "should not show" } : null,
  )
  buffer.point = buffer.text.indexOf("foo")
  void editor.prompt("Test: ")
  expect(editor.minibuffer).not.toBeNull()
  const line = await eldocPrintCurrentSymbolInfo(editor)
  expect(line).toBeNull()
  expect(calls.find(c => c.method === "textDocument/hover")).toBeUndefined()
  editor.minibufferCancel()
})

test("stays silent when neither eldoc-mode nor global-eldoc-mode is enabled", async () => {
  const { editor, buffer, lastMessage } = setupLsp(method =>
    method === "textDocument/hover" ? { contents: "x" } : null,
  )
  editor.disableMinorMode("global-eldoc-mode")
  expect(editor.isMinorModeEnabled("eldoc-mode", buffer)).toBe(false)
  const line = await eldocPrintCurrentSymbolInfo(editor)
  expect(line).toBeNull()
  expect(lastMessage()).toBe("")
})

test("eldoc command forces a fresh display", async () => {
  const { editor, buffer, lastMessage } = setupLsp(method =>
    method === "textDocument/hover" ? { contents: "forced" } : null,
  )
  buffer.point = buffer.text.indexOf("foo")
  buffer.locals.set("eldoc-last-message", "forced")
  await editor.run("eldoc")
  expect(lastMessage()).toBe("forced")
})

test("eldoc command messages when nothing is available", async () => {
  const editor = makeEditor()
  install(editor)
  track(eldocScheduleTimer(editor))
  let msg = ""
  editor.events.on("message", e => { msg = e.text })
  await editor.run("eldoc")
  expect(msg).toBe("No documentation at point")
})

test("idle timer fires after eldoc-idle-delay and resets on activity", async () => {
  const editor = makeEditor()
  await persistInstall(editor)
  install(editor)
  setCustom("eldoc-idle-delay", 0.03)
  track(eldocScheduleTimer(editor))
  const eldocFunction: EldocFunction = () => "idle-doc"
  defineMode({ name: "eldoc-idle-lang", eldocFunction } as Parameters<typeof defineMode>[0])
  editor.enterMode(editor.currentBuffer, "eldoc-idle-lang")

  let msg = ""
  editor.events.on("message", e => { msg = e.text })

  await sleep(15)
  await editor.changed("test-activity")
  await sleep(15)
  await editor.changed("test-activity")
  expect(msg).toBe("")
  await sleep(50)
  expect(msg).toBe("idle-doc")
})
