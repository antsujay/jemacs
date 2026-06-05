import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { install } from "../../plugins/next-error"

// t-d69c646b: counsel-ag must run rg from the visited buffer's project root,
// not process.cwd(). Repro: visiting a file under a go.mod-rooted subproject
// returned hits relative to the editor's launch dir, so results were wrong (or
// from the wrong tree entirely) once the editor was launched from elsewhere.
test("counsel-ag searches from the buffer's project root, not process.cwd()", async () => {
  const root = await mkdtemp(join(tmpdir(), "jemacs-counsel-ag-"))
  await writeFile(join(root, "go.mod"), "module example\n")
  await mkdir(join(root, "task"), { recursive: true })
  await writeFile(join(root, "task", "task.go"), "package task\n\ntype Priority int\n")
  const main = join(root, "main.go")
  await writeFile(main, "package main\n")

  const editor = makeEditor()
  install(editor)
  await editor.openFile(main)
  expect(editor.currentBuffer.path).toBe(main)

  await editor.run("counsel-ag", "Priority")

  const grep = [...editor.buffers.values()].find(b => b.name === "*grep*")!
  // The cwd handed to rg is recorded as default-directory on the *grep* buffer.
  // It must be the go.mod project root — never the test runner's process.cwd().
  expect(grep.locals.get("default-directory")).toBe(root)
  expect(grep.locals.get("default-directory")).not.toBe(process.cwd())
  // And the hit path must therefore be resolved under that root.
  expect(grep.text).toContain("task.go")
})
