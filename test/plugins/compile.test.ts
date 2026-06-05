import { beforeAll, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { makeEditor } from "./helper"
import {
  install,
  compilationStart,
  compilationErrorRegexpAlist,
  parseCompilationOutput,
  lastCompileCommand,
  lastCompileDirectory,
  type CompileDeps,
} from "../../plugins/compile"
import { install as installNextError, locationList, locationIndex } from "../../plugins/next-error"
import { getMode } from "../../src/modes/mode"
import type { SpawnHandle, SpawnOptions } from "../../src/platform/runtime"

let dir: string
let srcA: string
let srcB: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "jemacs-compile-"))
  srcA = join(dir, "a.c")
  srcB = join(dir, "b.py")
  await writeFile(srcA, "int main(void) {\n  return x;\n}\n")
  await writeFile(srcB, "def f():\n    raise ValueError\n\nf()\n")
  await writeFile(join(dir, ".git"), "")
})

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c))
      ctrl.close()
    },
  })
}

function fakeSpawn(behavior: (opts: SpawnOptions) => { stdout?: string[]; stderr?: string[]; code?: number }) {
  const calls: SpawnOptions[] = []
  const spawn = (opts: SpawnOptions): SpawnHandle => {
    calls.push(opts)
    const r = behavior(opts)
    return {
      stdin: null,
      stdout: streamOf(r.stdout ?? []),
      stderr: streamOf(r.stderr ?? []),
      exited: Promise.resolve(r.code ?? 0),
      kill: () => {},
    }
  }
  return { spawn, calls }
}

test("compilationErrorRegexpAlist covers gnu/rustc/msft/python/node patterns", () => {
  const names = compilationErrorRegexpAlist.map(r => r.name)
  expect(names).toContain("gnu")
  expect(names).toContain("rustc")
  expect(names).toContain("msft")
  expect(names).toContain("python-tracebacks")
  expect(names).toContain("node-stack")
})

test("parseCompilationOutput resolves relative paths against cwd and recognises each pattern", () => {
  const out = [
    "a.c:2:10: error: use of undeclared identifier 'x'",
    "src/main.rs:5: warning: unused variable",
    "  --> src/lib.rs:14:3",
    "src/app.ts(7,12): error TS2304: Cannot find name 'foo'.",
    '  File "b.py", line 2, in f',
    "    at Object.<anonymous> (/abs/node.js:10:5)",
    "make: *** [all] Error 1",
  ].join("\n")
  const locs = parseCompilationOutput(out, dir)
  expect(locs).toEqual([
    { file: join(dir, "a.c"), line: 2, col: 10, text: "a.c:2:10: error: use of undeclared identifier 'x'" },
    { file: join(dir, "src/main.rs"), line: 5, col: 1, text: "src/main.rs:5: warning: unused variable" },
    { file: join(dir, "src/lib.rs"), line: 14, col: 3, text: "--> src/lib.rs:14:3" },
    { file: join(dir, "src/app.ts"), line: 7, col: 12, text: "src/app.ts(7,12): error TS2304: Cannot find name 'foo'." },
    { file: join(dir, "b.py"), line: 2, col: 1, text: 'File "b.py", line 2, in f' },
    { file: "/abs/node.js", line: 10, col: 5, text: "at Object.<anonymous> (/abs/node.js:10:5)" },
  ])
})

test("parseCompilationOutput skips timestamps and non-file lines", () => {
  const locs = parseCompilationOutput("12:34:56 build started\nno colons here\n", "/tmp")
  expect(locs).toEqual([])
})

test("install registers commands and compilation mode keymap", () => {
  const editor = makeEditor()
  install(editor)
  expect(editor.commands.get("compile")).toBeDefined()
  expect(editor.commands.get("recompile")).toBeDefined()
  expect(editor.commands.get("kill-compilation")).toBeDefined()
  const mode = getMode("compilation")
  expect(mode).toBeDefined()
  expect(mode?.keymap?.get("g")).toBe("recompile")
  expect(mode?.keymap?.get("enter")).toBe("compile-goto-error")
  expect(mode?.keymap?.get("C-c C-k")).toBe("kill-compilation")
})

test("compile prompts with compile-command history defaulting to make -k", async () => {
  const editor = makeEditor()
  const { spawn } = fakeSpawn(() => ({ stdout: [""], code: 0 }))
  install(editor, { spawn, projectRoot: async () => dir })

  const pending = editor.run("compile")
  await Promise.resolve()
  expect(editor.minibuffer).not.toBeNull()
  expect(editor.minibuffer?.prompt).toBe("Compile command: ")
  expect(editor.minibuffer?.historyName).toBe("compile-command")
  expect(editor.activeBuffer.text).toBe("make -k ")
  editor.minibufferCancel()
  await pending

  expect(editor.minibufferHistory.get("compile-command")).toBeUndefined()
})

test("compile spawns via shell in project root, streams output, populates location list", async () => {
  const editor = makeEditor()
  installNextError(editor)
  const stderr = [
    "a.c:2:10: error: ",
    "use of undeclared identifier 'x'\n",
    "1 error generated.\n",
  ]
  const { spawn, calls } = fakeSpawn(() => ({ stderr, code: 1 }))
  const deps: CompileDeps = { spawn, projectRoot: async p => (expect(p).toBe(srcA), dir) }
  install(editor, deps)

  await editor.openFile(srcA)
  await editor.run("compile", ["cc -c a.c"])

  expect(calls.length).toBe(1)
  expect(calls[0]!.cmd).toEqual(["sh", "-c", "cc -c a.c"])
  expect(calls[0]!.cwd).toBe(dir)

  const buf = editor.currentBuffer
  expect(buf.name).toBe("*compilation*")
  expect(buf.mode).toBe("compilation")
  expect(buf.readOnly).toBe(true)
  expect(buf.text).toContain(`default-directory: ${JSON.stringify(dir)}`)
  expect(buf.text).toContain("cc -c a.c")
  expect(buf.text).toContain("a.c:2:10: error: use of undeclared identifier 'x'")
  expect(buf.text).toContain("Compilation exited abnormally with code 1")
  expect(buf.locals.get("default-directory")).toBe(dir)

  const locs = locationList(editor)
  expect(locs.length).toBe(1)
  expect(locs[0]).toEqual({
    file: srcA,
    line: 2,
    col: 10,
    text: "a.c:2:10: error: use of undeclared identifier 'x'",
  })
  expect(lastCompileCommand(editor)).toBe("cc -c a.c")
  expect(lastCompileDirectory(editor)).toBe(dir)
})

test("next-error visits parsed compilation locations", async () => {
  const editor = makeEditor()
  installNextError(editor)
  const out = `a.c:2:10: error: x\n  File "b.py", line 2\n`
  const { spawn } = fakeSpawn(() => ({ stdout: [out], code: 1 }))
  install(editor, { spawn, projectRoot: async () => dir })

  await editor.openFile(srcA)
  await editor.run("compile", ["make"])
  expect(locationList(editor).length).toBe(2)

  await editor.run("next-error")
  expect(locationIndex(editor)).toBe(0)
  expect(editor.currentBuffer.path).toBe(srcA)
  expect(editor.currentBuffer.lineCol()).toEqual({ line: 2, col: 10 })

  await editor.run("next-error")
  expect(locationIndex(editor)).toBe(1)
  expect(editor.currentBuffer.path).toBe(srcB)
  expect(editor.currentBuffer.lineCol()).toEqual({ line: 2, col: 1 })
})

test("g in *compilation* runs recompile and reuses the last command/directory", async () => {
  const editor = makeEditor()
  let n = 0
  const { spawn, calls } = fakeSpawn(() => ({ stdout: [`run ${++n}\n`], code: 0 }))
  install(editor, { spawn, projectRoot: async () => dir })

  await editor.openFile(srcA)
  await editor.run("compile", ["echo hi"])
  expect(calls.length).toBe(1)
  expect(editor.currentBuffer.name).toBe("*compilation*")
  expect(editor.currentBuffer.text).toContain("run 1")
  expect(editor.currentBuffer.text).toContain("Compilation finished")

  await editor.handleKey({ name: "g", sequence: "g" })
  expect(calls.length).toBe(2)
  expect(calls[1]!.cmd).toEqual(["sh", "-c", "echo hi"])
  expect(calls[1]!.cwd).toBe(dir)
  expect(editor.currentBuffer.text).toContain("run 2")
  expect(editor.currentBuffer.text).not.toContain("run 1")
})

test("compile records history and second prompt offers the last command", async () => {
  const editor = makeEditor()
  const { spawn } = fakeSpawn(() => ({ code: 0 }))
  install(editor, { spawn, projectRoot: async () => dir })

  let pending = editor.run("compile")
  await Promise.resolve()
  editor.activeBuffer.setText("bun test", true)
  editor.minibufferSubmit()
  await pending
  expect(editor.minibufferHistory.get("compile-command")).toEqual(["bun test"])
  expect(lastCompileCommand(editor)).toBe("bun test")

  editor.switchToBuffer("*scratch*")
  pending = editor.run("compile")
  await Promise.resolve()
  expect(editor.activeBuffer.text).toBe("bun test")
  editor.minibufferCancel()
  await pending
})

test("kill-compilation messages when nothing running", async () => {
  const editor = makeEditor()
  install(editor)
  let msg = ""
  editor.events.on("message", ({ text }) => { msg = text })
  await editor.run("kill-compilation")
  expect(msg).toContain("No compilation process running")
})

test("compilationStart with real shell streams stdout into *compilation*", async () => {
  const editor = makeEditor()
  install(editor)
  const buf = await compilationStart(editor, `printf 'x.c:1:2: error: boom\\n'`, dir)
  expect(buf.name).toBe("*compilation*")
  expect(buf.text).toContain("x.c:1:2: error: boom")
  expect(buf.text).toContain("Compilation finished")
  const locs = locationList(editor)
  expect(locs.length).toBe(1)
  expect(locs[0]!.file).toBe(resolve(dir, "x.c"))
})
