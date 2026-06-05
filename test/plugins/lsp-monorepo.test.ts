import { describe, expect, test } from "bun:test"
import {
  ensureRaMultiplexServer,
  install,
  makeRaMultiplexClient,
  RA_MULTIPLEX_CLIENT_CMD,
  RA_MULTIPLEX_SERVER_CMD,
  raMultiplexRunning,
  rustAnalyzerInitOptions,
} from "../../plugins/lsp-monorepo"
import { getClient } from "../../src/lsp/client"
import { registerRustAnalyzerClient } from "../../src/lsp/clients/rust-analyzer"
import type { SpawnHandle, SpawnOptions } from "../../src/platform/runtime"
import { makeEditor } from "./helper"

function fakeSpawn(exitCodes: Record<string, number | null>) {
  const calls: SpawnOptions[] = []
  const spawn = (opts: SpawnOptions): SpawnHandle => {
    calls.push(opts)
    const code = exitCodes[opts.cmd[0]!] ?? 0
    return {
      stdin: null,
      stdout: null,
      stderr: null,
      exited: Promise.resolve(code),
      kill: () => {},
    }
  }
  return { spawn, calls }
}

describe("lsp-monorepo: rust-analyzer initializationOptions", () => {
  test("matches the monorepo tuning", () => {
    const opts = rustAnalyzerInitOptions()
    expect(opts.check.workspace).toBe(false)
    expect(opts.check.extraArgs).toEqual(["--jobs", "8"])
    expect(opts.cargo.allTargets).toBe(false)
    expect(opts.cachePriming.numThreads).toBe(8)
    expect(opts.numThreads).toBe(8)
    expect(opts.files.watcher).toBe("client")
  })

  test("client.initializationOptions resolves to the same shape", () => {
    const client = makeRaMultiplexClient()
    const init = typeof client.initializationOptions === "function"
      ? client.initializationOptions()
      : client.initializationOptions
    expect(init).toEqual(rustAnalyzerInitOptions())
  })
})

describe("lsp-monorepo: ra-multiplex client registration", () => {
  test("targets rust mode via ra-multiplex client", () => {
    const client = makeRaMultiplexClient()
    expect(client.serverId).toBe("ra-multiplex")
    expect(client.majorModes).toEqual(["rust"])
    expect(client.languageId({ mode: "rust" } as never)).toBe("rust")
    expect(RA_MULTIPLEX_CLIENT_CMD).toEqual(["ra-multiplex", "client", "--server-path", "rust-analyzer"])
  })

  test("outranks the default rust-analyzer client", () => {
    registerRustAnalyzerClient()
    const editor = makeEditor()
    install(editor)
    const ra = getClient("rust-analyzer")
    const mux = getClient("ra-multiplex")
    expect(mux).toBeDefined()
    expect(mux!.priority).toBeGreaterThan(ra?.priority ?? 0)
  })
})

describe("lsp-monorepo: $/progress is dropped", () => {
  test("notification handler swallows progress without error", () => {
    const client = makeRaMultiplexClient()
    const handler = client.notificationHandlers?.get("$/progress")
    expect(handler).toBeInstanceOf(Function)
    const ws = {} as Parameters<NonNullable<typeof handler>>[0]
    expect(() => handler!(ws, { token: "rustAnalyzer/indexing", value: { kind: "report" } })).not.toThrow()
    expect(handler!(ws, {})).toBeUndefined()
  })
})

describe("lsp-monorepo: ra-multiplex server auto-start", () => {
  test("returns 'unavailable' when binary is missing", async () => {
    const { spawn, calls } = fakeSpawn({})
    const state = await ensureRaMultiplexServer({ spawn, which: () => null })
    expect(state).toBe("unavailable")
    expect(calls).toHaveLength(0)
  })

  test("returns 'running' when status exits 0", async () => {
    const { spawn, calls } = fakeSpawn({ "ra-multiplex": 0 })
    const state = await ensureRaMultiplexServer({ spawn, which: () => "/usr/bin/ra-multiplex" })
    expect(state).toBe("running")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.cmd).toEqual(["ra-multiplex", "status"])
  })

  test("starts a niced server when status fails", async () => {
    const { spawn, calls } = fakeSpawn({ "ra-multiplex": 1, sh: 0 })
    const state = await ensureRaMultiplexServer({ spawn, which: () => "/usr/bin/ra-multiplex" })
    expect(state).toBe("started")
    expect(calls).toHaveLength(2)
    expect(calls[0]!.cmd).toEqual(["ra-multiplex", "status"])
    expect(calls[1]!.cmd).toEqual(["sh", "-c", RA_MULTIPLEX_SERVER_CMD])
    expect(RA_MULTIPLEX_SERVER_CMD).toContain("nice -n10")
    expect(RA_MULTIPLEX_SERVER_CMD).toContain("ra-multiplex server")
  })

  test("raMultiplexRunning treats spawn errors as not running", async () => {
    const spawn = () => {
      throw new Error("ENOENT")
    }
    expect(await raMultiplexRunning(spawn)).toBe(false)
  })
})
