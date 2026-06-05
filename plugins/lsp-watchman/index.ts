import { join } from "node:path"
import type { Editor } from "../../src/kernel/editor"
import type { LspWorkspace } from "../../src/lsp/workspace"
import { allClients, type RequestHandler } from "../../src/lsp/client"
import { pathToUri } from "../../src/lsp/positions"
import { spawnProcess } from "../../src/platform/runtime"
import { defcustom, getCustom } from "../../src/runtime/custom"
import { addAdvice } from "../../src/runtime/advice"

export type WatchmanExpression = readonly [string, ...unknown[]]

export type WatchmanFile = { name: string; exists: boolean; new: boolean }

export type WatchmanResponse = {
  is_fresh_instance?: boolean
  files?: WatchmanFile[]
  error?: string
}

export type WatchmanRunner = (query: unknown) => Promise<WatchmanResponse>

type GlobPattern = string | { pattern?: string; baseUri?: unknown }
type FileSystemWatcher = { globPattern?: GlobPattern; pattern?: GlobPattern; kind?: number }
type Registration = { id: string; method: string; registerOptions?: { watchers?: FileSystemWatcher[] } }
type RegistrationParams = { registrations?: Registration[] }
type UnregistrationParams = { unregisterations?: Array<{ id: string; method: string }> }

type WatchState = {
  root: string
  cursor: string
  expression: WatchmanExpression
  primed: boolean
  timer: ReturnType<typeof setInterval> | null
  runner: WatchmanRunner
}

const state = new Map<LspWorkspace, WatchState>()

export const stats = { polls: 0, notifications: 0, files: 0, errors: 0 }

/** LSP FileChangeType: 1=Created 2=Changed 3=Deleted. */
export function lspChangeType(file: Pick<WatchmanFile, "exists" | "new">): 1 | 2 | 3 {
  if (!file.exists) return 3
  if (file.new) return 1
  return 2
}

function patternString(watcher: FileSystemWatcher): string | null {
  const raw = watcher.globPattern ?? watcher.pattern ?? watcher
  if (typeof raw === "string") return raw
  if (raw && typeof raw === "object" && typeof raw.pattern === "string") return raw.pattern
  return null
}

/**
 * Convert LSP FileSystemWatchers to a watchman expression.  Recognises
 * `…*.SUFFIX` and `**\/BASENAME`; unrecognised globs (brace expansion,
 * mid-path wildcards) are dropped — the same trade-off eglot-watchman makes.
 */
export function watchersToExpression(watchers: readonly FileSystemWatcher[]): WatchmanExpression {
  const suffixes = new Set<string>()
  const basenames = new Set<string>()
  for (const watcher of watchers) {
    const pat = patternString(watcher)
    if (!pat) continue
    const suffix = pat.match(/\*\.([A-Za-z0-9_]+)$/)
    if (suffix) {
      suffixes.add(suffix[1]!)
      continue
    }
    const base = pat.match(/\*\*\/([^*{}/]+)$/)
    if (base) basenames.add(base[1]!)
  }
  const anyof: WatchmanExpression[] = [
    ...[...suffixes].map(s => ["suffix", s] as const),
    ...[...basenames].map(b => ["name", b] as const),
  ]
  return ["allof", ["type", "f"], ["anyof", ...anyof]]
}

export function buildSinceQuery(root: string, cursor: string, expression: WatchmanExpression): unknown {
  return ["query", root, {
    since: cursor,
    expression,
    fields: ["name", "exists", "new"],
  }]
}

/** Spawn `watchman -j --no-pretty`, write the JSON query on stdin, parse the JSON line back. */
export const defaultRunner: WatchmanRunner = async query => {
  const proc = spawnProcess({ cmd: ["watchman", "-j", "--no-pretty"], stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  proc.stdin?.write(JSON.stringify(query))
  proc.stdin?.end()
  let out = ""
  if (proc.stdout) {
    const decoder = new TextDecoder()
    for await (const chunk of proc.stdout) out += decoder.decode(chunk)
  }
  const code = await proc.exited
  if (code !== 0) throw new Error(`watchman exited ${code}: ${out}`)
  return JSON.parse(out) as WatchmanResponse
}

export function filesToChanges(root: string, files: readonly WatchmanFile[]) {
  return files.map(f => ({
    uri: pathToUri(join(root, f.name)),
    type: lspChangeType(f),
  }))
}

export async function pollOnce(editor: Editor, workspace: LspWorkspace): Promise<void> {
  const st = state.get(workspace)
  if (!st || workspace.status === "shutdown") return
  stats.polls++
  try {
    const resp = await st.runner(buildSinceQuery(st.root, st.cursor, st.expression))
    if (resp.error) throw new Error(resp.error)
    const files = resp.files ?? []
    if (resp.is_fresh_instance || !st.primed) {
      st.primed = true
      return
    }
    if (!files.length) return
    stats.notifications++
    stats.files += files.length
    workspace.rpc.sendNotification("workspace/didChangeWatchedFiles", {
      changes: filesToChanges(st.root, files),
    })
  } catch (err) {
    stats.errors++
    editor.message(`lsp-watchman poll error: ${(err as Error).message}`)
  }
}

function hashCursor(root: string, id: string): string {
  let h = 2166136261
  const s = `${root}:${id}`
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return `n:jemacs-${(h >>> 0).toString(16)}`
}

export function registerCapability(
  editor: Editor,
  workspace: LspWorkspace,
  id: string,
  watchers: readonly FileSystemWatcher[],
  runner: WatchmanRunner = defaultRunner,
): void {
  const old = state.get(workspace)
  if (old?.timer) clearInterval(old.timer)
  const root = workspace.root
  const cursor = hashCursor(root, id)
  const expression = watchersToExpression(watchers)
  const intervalMs = (getCustom<number>("lsp-watchman-poll-interval") ?? 1.5) * 1000
  const st: WatchState = { root, cursor, expression, primed: false, runner, timer: null }
  state.set(workspace, st)
  st.timer = setInterval(() => void pollOnce(editor, workspace), intervalMs)
  editor.message(
    `lsp-watchman: polling ${root} every ${intervalMs / 1000}s for ${JSON.stringify(expression)}`,
  )
}

export function unregisterCapability(workspace: LspWorkspace): void {
  const st = state.get(workspace)
  if (!st) return
  if (st.timer) clearInterval(st.timer)
  state.delete(workspace)
}

export function watchState(workspace: LspWorkspace) {
  return state.get(workspace)
}

export function handleRegisterCapability(
  editor: Editor,
  workspace: LspWorkspace,
  params: unknown,
  runner: WatchmanRunner = defaultRunner,
): unknown {
  const regs = (params as RegistrationParams | null)?.registrations ?? []
  for (const reg of regs) {
    if (reg.method !== "workspace/didChangeWatchedFiles") continue
    registerCapability(editor, workspace, reg.id, reg.registerOptions?.watchers ?? [], runner)
  }
  return null
}

export function handleUnregisterCapability(workspace: LspWorkspace, params: unknown): unknown {
  const unregs = (params as UnregistrationParams | null)?.unregisterations ?? []
  for (const u of unregs) {
    if (u.method === "workspace/didChangeWatchedFiles") unregisterCapability(workspace)
  }
  return null
}

export function install(editor: Editor): void {
  defcustom("lsp-watchman-poll-interval", "number", 1.5,
    "Seconds between watchman since-queries for workspace/didChangeWatchedFiles.")

  const onRegister: RequestHandler = (workspace, params) =>
    handleRegisterCapability(editor, workspace, params)
  const onUnregister: RequestHandler = (workspace, params) =>
    handleUnregisterCapability(workspace, params)

  for (const client of allClients()) {
    const handlers = client.requestHandlers ?? new Map()
    handlers.set("client/registerCapability", onRegister)
    handlers.set("client/unregisterCapability", onUnregister)
    client.requestHandlers = handlers
  }

  addAdvice("lsp-shutdown-workspace", {
    before: ({ editor: ed }) => {
      for (const ws of ed.lsp?.bufferWorkspaces(ed.currentBuffer) ?? []) unregisterCapability(ws)
    },
  })

  editor.command("lsp-watchman-stats", ({ editor: ed }) => {
    ed.message(
      `lsp-watchman: polls=${stats.polls} notifications=${stats.notifications} files=${stats.files} errors=${stats.errors}`,
    )
  }, "Show watchman poll counters.")
}
