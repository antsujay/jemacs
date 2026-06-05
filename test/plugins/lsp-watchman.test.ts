import { describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import {
  buildSinceQuery,
  filesToChanges,
  handleRegisterCapability,
  handleUnregisterCapability,
  install,
  lspChangeType,
  pollOnce,
  registerCapability,
  stats,
  unregisterCapability,
  watchersToExpression,
  watchState,
  type WatchmanResponse,
  type WatchmanRunner,
} from "../../plugins/lsp-watchman"
import { allClients, registerClient } from "../../src/lsp/client"
import { pathToUri } from "../../src/lsp/positions"
import { getCustom } from "../../src/runtime/custom"
import type { LspWorkspace } from "../../src/lsp/workspace"

function fakeWorkspace(root = "/repo") {
  const sent: Array<{ method: string; params: unknown }> = []
  const ws: LspWorkspace = {
    root,
    client: {
      serverId: "fake",
      majorModes: ["rust"],
      priority: 0,
      languageId: () => "rust",
      newConnection: { connect: () => ({ send: () => {}, proc: { kill: () => {} } }) },
    },
    status: "initialized",
    buffers: [],
    openedUris: new Set(),
    serverCapabilities: null,
    diagnosticsByPath: new Map(),
    rpc: {
      sendNotification: (method, params) => sent.push({ method, params }),
      request: async () => null,
      requestAsync: () => 0,
      dispose: () => {},
    },
    send: () => {},
    kill: () => {},
    uriForBuffer: () => "",
  }
  return { ws, sent }
}

function scriptedRunner(responses: WatchmanResponse[]): { runner: WatchmanRunner; queries: unknown[] } {
  const queries: unknown[] = []
  let i = 0
  const runner: WatchmanRunner = async query => {
    queries.push(query)
    return responses[Math.min(i++, responses.length - 1)] ?? { files: [] }
  }
  return { runner, queries }
}

describe("lsp-watchman: glob → watchman expression", () => {
  test("extracts suffix and basename patterns", () => {
    const expr = watchersToExpression([
      { globPattern: "**/*.rs" },
      { globPattern: "**/*.toml" },
      { globPattern: "**/Cargo.lock" },
    ])
    expect(expr).toEqual([
      "allof",
      ["type", "f"],
      ["anyof", ["suffix", "rs"], ["suffix", "toml"], ["name", "Cargo.lock"]],
    ])
  })

  test("dedupes patterns and unwraps RelativePattern objects", () => {
    const expr = watchersToExpression([
      { globPattern: "**/*.go" },
      { globPattern: { pattern: "**/*.go", baseUri: "file:///repo" } },
      { globPattern: "src/*.go" },
    ])
    expect(expr).toEqual(["allof", ["type", "f"], ["anyof", ["suffix", "go"]]])
  })

  test("drops unrecognised globs (brace expansion, mid-path wildcards)", () => {
    const expr = watchersToExpression([
      { globPattern: "**/*.{ts,tsx}" },
      { globPattern: "**/node_modules/**" },
    ])
    expect(expr).toEqual(["allof", ["type", "f"], ["anyof"]])
  })
})

describe("lsp-watchman: FileChangeType mapping", () => {
  test("exists=false → Deleted(3)", () => {
    expect(lspChangeType({ exists: false, new: false })).toBe(3)
    expect(lspChangeType({ exists: false, new: true })).toBe(3)
  })
  test("new=true → Created(1)", () => {
    expect(lspChangeType({ exists: true, new: true })).toBe(1)
  })
  test("else → Changed(2)", () => {
    expect(lspChangeType({ exists: true, new: false })).toBe(2)
  })
})

describe("lsp-watchman: since-query", () => {
  test("buildSinceQuery emits the watchman wire shape", () => {
    const q = buildSinceQuery("/repo", "n:jemacs-abc", ["allof", ["type", "f"], ["anyof", ["suffix", "rs"]]])
    expect(q).toEqual([
      "query",
      "/repo",
      {
        since: "n:jemacs-abc",
        expression: ["allof", ["type", "f"], ["anyof", ["suffix", "rs"]]],
        fields: ["name", "exists", "new"],
      },
    ])
  })

  test("filesToChanges resolves paths against root and emits file:// URIs", () => {
    const changes = filesToChanges("/repo", [
      { name: "src/lib.rs", exists: true, new: true },
      { name: "src/old.rs", exists: false, new: false },
    ])
    expect(changes).toEqual([
      { uri: pathToUri("/repo/src/lib.rs"), type: 1 },
      { uri: pathToUri("/repo/src/old.rs"), type: 3 },
    ])
  })
})

describe("lsp-watchman: poll loop", () => {
  test("first (fresh) poll primes; second sends didChangeWatchedFiles", async () => {
    const editor = makeEditor()
    const { ws, sent } = fakeWorkspace()
    const { runner, queries } = scriptedRunner([
      { is_fresh_instance: true, files: [{ name: "a.rs", exists: true, new: false }] },
      { files: [
        { name: "a.rs", exists: true, new: false },
        { name: "b.rs", exists: true, new: true },
        { name: "c.rs", exists: false, new: false },
      ] },
    ])
    registerCapability(editor, ws, "watch-1", [{ globPattern: "**/*.rs" }], runner)
    const st = watchState(ws)!
    expect(st.cursor.startsWith("n:jemacs-")).toBe(true)
    expect(st.primed).toBe(false)

    await pollOnce(editor, ws)
    expect(st.primed).toBe(true)
    expect(sent).toHaveLength(0)
    expect((queries[0] as unknown[])[0]).toBe("query")
    expect((queries[0] as unknown[])[1]).toBe("/repo")

    await pollOnce(editor, ws)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.method).toBe("workspace/didChangeWatchedFiles")
    const params = sent[0]!.params as { changes: Array<{ uri: string; type: number }> }
    expect(params.changes).toEqual([
      { uri: pathToUri("/repo/a.rs"), type: 2 },
      { uri: pathToUri("/repo/b.rs"), type: 1 },
      { uri: pathToUri("/repo/c.rs"), type: 3 },
    ])
    unregisterCapability(ws)
  })

  test("empty file list after priming sends nothing", async () => {
    const editor = makeEditor()
    const { ws, sent } = fakeWorkspace()
    const { runner } = scriptedRunner([{ files: [] }, { files: [] }])
    registerCapability(editor, ws, "watch-2", [{ globPattern: "**/*.rs" }], runner)
    await pollOnce(editor, ws)
    await pollOnce(editor, ws)
    expect(sent).toHaveLength(0)
    unregisterCapability(ws)
  })

  test("runner errors are caught and counted", async () => {
    const editor = makeEditor()
    const { ws, sent } = fakeWorkspace()
    const before = stats.errors
    const runner: WatchmanRunner = async () => {
      throw new Error("watchman not running")
    }
    registerCapability(editor, ws, "watch-3", [], runner)
    let msg = ""
    editor.events.on("message", e => { msg = e.text })
    await pollOnce(editor, ws)
    expect(stats.errors).toBe(before + 1)
    expect(sent).toHaveLength(0)
    expect(msg).toContain("lsp-watchman poll error")
    unregisterCapability(ws)
  })
})

describe("lsp-watchman: capability registration", () => {
  test("handleRegisterCapability picks out didChangeWatchedFiles registrations", () => {
    const editor = makeEditor()
    const { ws } = fakeWorkspace("/monorepo")
    const { runner } = scriptedRunner([{ files: [] }])
    handleRegisterCapability(editor, ws, {
      registrations: [
        { id: "x", method: "textDocument/formatting", registerOptions: {} },
        { id: "y", method: "workspace/didChangeWatchedFiles", registerOptions: { watchers: [{ globPattern: "**/*.rs" }] } },
      ],
    }, runner)
    const st = watchState(ws)
    expect(st).toBeDefined()
    expect(st!.root).toBe("/monorepo")
    expect(st!.expression).toEqual(["allof", ["type", "f"], ["anyof", ["suffix", "rs"]]])
    expect(st!.timer).not.toBeNull()
    handleUnregisterCapability(ws, {
      unregisterations: [{ id: "y", method: "workspace/didChangeWatchedFiles" }],
    })
    expect(watchState(ws)).toBeUndefined()
  })

  test("re-registration replaces the previous timer", () => {
    const editor = makeEditor()
    const { ws } = fakeWorkspace()
    const { runner } = scriptedRunner([{ files: [] }])
    registerCapability(editor, ws, "a", [{ globPattern: "**/*.rs" }], runner)
    const first = watchState(ws)!.timer
    registerCapability(editor, ws, "b", [{ globPattern: "**/*.go" }], runner)
    const second = watchState(ws)!
    expect(second.timer).not.toBe(first)
    expect(second.expression).toEqual(["allof", ["type", "f"], ["anyof", ["suffix", "go"]]])
    unregisterCapability(ws)
  })
})

describe("lsp-watchman: install", () => {
  test("defines defcustom, command, and wires client requestHandlers", () => {
    registerClient({
      serverId: "watchman-test-client",
      majorModes: ["rust"],
      priority: 0,
      languageId: () => "rust",
      newConnection: { connect: () => ({ send: () => {}, proc: { kill: () => {} } }) },
    })
    const editor = makeEditor()
    install(editor)
    expect(getCustom<number>("lsp-watchman-poll-interval")).toBe(1.5)
    expect(editor.commands.get("lsp-watchman-stats")).toBeDefined()
    const client = allClients().find(c => c.serverId === "watchman-test-client")!
    expect(client.requestHandlers?.get("client/registerCapability")).toBeInstanceOf(Function)
    expect(client.requestHandlers?.get("client/unregisterCapability")).toBeInstanceOf(Function)
  })
})
