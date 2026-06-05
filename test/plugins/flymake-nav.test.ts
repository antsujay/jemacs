import { expect, test, beforeAll } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "./helper"
import { install } from "../../plugins/flymake-nav"
import { install as installNextError, locationList, locationIndex } from "../../plugins/next-error"
import { BufferModel } from "../../src/kernel/buffer"
import { LspManager } from "../../src/lsp/manager"
import type { LspWorkspace } from "../../src/lsp/workspace"
import type { LspDiagnostic } from "../../src/lsp/buffer-state"
import { setCustom } from "../../src/runtime/custom"

type Severity = 1 | 2 | 3 | 4

function diag(line: number, character: number, message: string, severity: Severity = 1, source?: string): LspDiagnostic {
  return {
    range: { start: { line, character }, end: { line, character: character + 1 } },
    message,
    severity,
    source,
  }
}

function setup(diagnostics: LspDiagnostic[]) {
  const editor = makeEditor()
  install(editor)
  const text = "line zero\nline one\nline two\nline three\n"
  const buffer = new BufferModel({ name: "a.ts", path: "/tmp/a.ts", text, kind: "file", mode: "typescript" })
  editor.addBuffer(buffer)
  editor.switchToBuffer(buffer.id)

  const ws = { diagnosticsByPath: new Map([[buffer.path!, diagnostics]]) } as unknown as LspWorkspace
  const lsp = new LspManager(editor)
  lsp.bufferWorkspaces = () => [ws]
  editor.lsp = lsp

  const messages: string[] = []
  editor.events.on("message", ({ text }) => { messages.push(text) })
  return { editor, buffer, messages }
}

test("registers commands and M-n/M-p bindings", () => {
  const editor = makeEditor()
  install(editor)
  expect(editor.commands.get("flymake-goto-next-error")).toBeDefined()
  expect(editor.commands.get("flymake-goto-prev-error")).toBeDefined()
  expect(editor.keymap.get("M-n")).toBe("flymake-goto-next-error")
  expect(editor.keymap.get("M-p")).toBe("flymake-goto-prev-error")
})

test("next-error walks forward through sorted diagnostics and echoes", async () => {
  const { editor, buffer, messages } = setup([
    diag(2, 0, "third", 2),
    diag(0, 5, "first", 1, "tsserver"),
    diag(1, 0, "second", 3),
  ])
  buffer.point = 0

  await editor.run("flymake-goto-next-error")
  expect(buffer.point).toBe(5)
  expect(messages.at(-1)).toBe("tsserver [error]: first")

  await editor.run("flymake-goto-next-error")
  expect(buffer.point).toBe(10)
  expect(messages.at(-1)).toBe("[info]: second")

  await editor.run("flymake-goto-next-error")
  expect(buffer.point).toBe(19)
  expect(messages.at(-1)).toBe("[warning]: third")
})

test("prev-error walks backward", async () => {
  const { editor, buffer } = setup([diag(0, 5, "a"), diag(1, 0, "b"), diag(2, 0, "c")])
  buffer.point = 19

  await editor.run("flymake-goto-prev-error")
  expect(buffer.point).toBe(10)
  await editor.run("flymake-goto-prev-error")
  expect(buffer.point).toBe(5)
})

test("wraps around at the ends when flymake-wrap-around is true", async () => {
  setCustom("flymake-wrap-around", true)
  const { editor, buffer } = setup([diag(0, 5, "a"), diag(2, 0, "c")])
  buffer.point = 19
  await editor.run("flymake-goto-next-error")
  expect(buffer.point).toBe(5)

  buffer.point = 5
  await editor.run("flymake-goto-prev-error")
  expect(buffer.point).toBe(19)
})

test("does not wrap when flymake-wrap-around is false", async () => {
  setCustom("flymake-wrap-around", false)
  const { editor, buffer, messages } = setup([diag(0, 5, "a"), diag(2, 0, "c")])
  buffer.point = 19
  await editor.run("flymake-goto-next-error")
  expect(buffer.point).toBe(19)
  expect(messages.at(-1)).toBe("No more Flymake diagnostics")
  setCustom("flymake-wrap-around", true)
})

test("skips diagnostic exactly at point", async () => {
  const { editor, buffer } = setup([diag(0, 5, "a"), diag(1, 0, "b")])
  buffer.point = 5
  await editor.run("flymake-goto-next-error")
  expect(buffer.point).toBe(10)
})

test("prefix arg filters to error/warning severity", async () => {
  const { editor, buffer } = setup([diag(0, 5, "hint", 3), diag(1, 0, "err", 1)])
  buffer.point = 0
  editor.prefixArg.universalArgument()
  await editor.run("flymake-goto-next-error")
  expect(buffer.point).toBe(10)
})

test("reports no diagnostics when buffer has none", async () => {
  const { editor, buffer, messages } = setup([])
  buffer.point = 3
  await editor.run("flymake-goto-next-error")
  expect(buffer.point).toBe(3)
  expect(messages.at(-1)).toBe("No more Flymake diagnostics")
})

// --- flymake-show-{buffer,project}-diagnostics --------------------------------

let dir: string
let fileA: string
let fileB: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "jemacs-flymake-"))
  fileA = join(dir, "a.ts")
  fileB = join(dir, "b.ts")
  await writeFile(fileA, "line zero\nline one\nline two\nline three\n")
  await writeFile(fileB, "alpha\nbeta\ngamma\n")
})

function setupOnDisk(byPath: Record<string, LspDiagnostic[]>, currentPath: string) {
  const editor = makeEditor()
  installNextError(editor)
  install(editor)
  const lsp = new LspManager(editor)
  const ws = { root: dir, diagnosticsByPath: new Map(Object.entries(byPath)) } as unknown as LspWorkspace
  lsp.bufferWorkspaces = () => [ws]
  lsp.workspaces.push(ws)
  editor.lsp = lsp

  const buffer = new BufferModel({ name: "a.ts", path: currentPath, text: "line zero\nline one\nline two\nline three\n", kind: "file", mode: "typescript" })
  editor.addBuffer(buffer)
  editor.switchToBuffer(buffer.id)

  const messages: string[] = []
  editor.events.on("message", ({ text }) => { messages.push(text) })
  return { editor, buffer, messages }
}

test("show-buffer-diagnostics opens a list buffer with one line per diagnostic, sorted", async () => {
  const { editor, messages } = setupOnDisk({
    [fileA]: [diag(2, 0, "third", 2), diag(0, 5, "first", 1, "tsserver"), diag(1, 0, "second", 3)],
  }, fileA)

  await editor.run("flymake-show-buffer-diagnostics")
  const buf = editor.currentBuffer
  expect(buf.name).toBe("*Flymake diagnostics for a.ts*")
  expect(buf.mode).toBe("flymake-diagnostics")
  expect(buf.readOnly).toBe(true)
  expect(buf.text).toBe(
    "a.ts:1:6: [error] first\n" +
    "a.ts:2:1: [info] second\n" +
    "a.ts:3:1: [warning] third\n",
  )
  expect(messages.at(-1)).toBe("3 diagnostics")
  expect(locationList(editor)).toHaveLength(3)
})

test("RET in *Flymake diagnostics* jumps to the diagnostic and syncs next-error", async () => {
  const { editor } = setupOnDisk({
    [fileA]: [diag(0, 5, "first"), diag(2, 0, "third", 2)],
  }, fileA)

  await editor.run("flymake-show-buffer-diagnostics")
  const list = editor.currentBuffer
  list.point = 0
  list.moveLine(1)

  const fed = editor.keymaps.feed({ name: "return" })
  expect(fed.status).toBe("matched")
  if (fed.status !== "matched") throw new Error("unreachable")
  expect(fed.command).toBe("compile-goto-error")
  await editor.run(fed.command)

  expect(editor.currentBuffer.path).toBe(fileA)
  expect(editor.currentBuffer.lineCol()).toEqual({ line: 3, col: 1 })
  expect(locationIndex(editor)).toBe(1)

  await editor.run("previous-error")
  expect(editor.currentBuffer.lineCol()).toEqual({ line: 1, col: 6 })
})

test("show-project-diagnostics collects across all workspace files, sorted by path", async () => {
  const { editor } = setupOnDisk({
    [fileB]: [diag(1, 2, "bad beta")],
    [fileA]: [diag(0, 5, "first"), diag(2, 0, "third", 2)],
  }, fileA)

  await editor.run("flymake-show-project-diagnostics")
  const buf = editor.currentBuffer
  expect(buf.name).toBe("*Flymake diagnostics for project*")
  expect(buf.text).toBe(
    "a.ts:1:6: [error] first\n" +
    "a.ts:3:1: [warning] third\n" +
    "b.ts:2:3: [error] bad beta\n",
  )
  const locs = buf.locals.get("next-error-locations") as { file: string }[]
  expect(locs.map(l => l.file)).toEqual([fileA, fileA, fileB])

  buf.point = 0
  buf.moveLine(2)
  await editor.run("compile-goto-error")
  expect(editor.currentBuffer.path).toBe(fileB)
  expect(editor.currentBuffer.lineCol()).toEqual({ line: 2, col: 3 })
})

test("show-buffer-diagnostics with no diagnostics just messages", async () => {
  const { editor, messages } = setupOnDisk({ [fileA]: [] }, fileA)
  const before = editor.currentBuffer
  await editor.run("flymake-show-buffer-diagnostics")
  expect(editor.currentBuffer).toBe(before)
  expect(messages.at(-1)).toBe("No Flymake diagnostics")
})
