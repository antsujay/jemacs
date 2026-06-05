import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { install, setLocationList, locationIndex } from "../../plugins/next-error"

// t-287a862f: compile-goto-error must resolve relative file refs against the
// compilation buffer's default-directory, not process.cwd(), and the resolved
// path must match the absolute entries already in s.locations so findIndex
// syncs the navigation index.
test("compile-goto-error resolves against default-directory and syncs location index", async () => {
  const root = await mkdtemp(join(tmpdir(), "jemacs-t287a862f-"))
  const projDir = join(root, "examples", "go-cli")
  await mkdir(join(projDir, "task"), { recursive: true })
  const target = join(projDir, "task", "task.go")
  await writeFile(target, "package task\n\nfunc F() {}\n")

  const editor = makeEditor()
  install(editor)

  // Prime s.locations the way compile's parseCompilationOutput would: absolute paths.
  setLocationList(editor, [{ file: target, line: 3, col: 1, text: "syntax error" }])

  // *compilation* buffer text contains the relative path as the compiler printed it.
  const buf = editor.scratch(
    "*compilation*",
    "go build ./...\ntask/task.go:3:1: syntax error\n",
    "grep",
  )
  buf.locals.set("default-directory", projDir)
  buf.point = buf.text.indexOf("task/task.go")

  expect(projDir).not.toBe(process.cwd())
  await editor.run("compile-goto-error")

  // Must open the real file under projDir, not process.cwd()/task/task.go.
  expect(editor.currentBuffer.path).toBe(target)
  expect(editor.currentBuffer.text).toContain("package task")
  // Resolved path matches s.locations[0], so findIndex synced the cursor.
  expect(locationIndex(editor)).toBe(0)
})

// t-d69c646b (merged): counsel-ag must run rg from the visited file's project
// root, not the editor's process.cwd().
test("counsel-ag searches from the buffer's project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "jemacs-td69c646b-"))
  const proj = join(root, "examples", "go-cli")
  await mkdir(proj, { recursive: true })
  await writeFile(join(proj, "go.mod"), "module example\n")
  await writeFile(join(proj, "main.go"), "package main\n// NEEDLE_td69c646b\n")

  const editor = makeEditor()
  install(editor)
  await editor.openFile(join(proj, "main.go"))

  await editor.run("counsel-ag", "NEEDLE_td69c646b")
  const grep = [...editor.buffers.values()].find(b => b.name === "*grep*")!
  // rg ran from proj, so default-directory records it and hits are proj-relative.
  expect(grep.locals.get("default-directory")).toBe(proj)
  expect(grep.text).toContain("main.go:2:")
  expect(grep.text).not.toContain("examples/go-cli/")
})
