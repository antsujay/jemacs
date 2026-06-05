import { expect, test } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BufferModel } from "../../src/kernel/buffer"

// t-a934d978: undo() must restore point (not jump to 1,1) and clear dirty at the
// saved baseline. Repro: type 10 chars at line 8, then undo back to start.
test("undo restores point and clears dirty at saved baseline", () => {
  const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n")
  const b = new BufferModel({ name: "filter.go", text, path: "/tmp/filter.go", kind: "file" })
  // Move to line 8 col 1.
  b.point = text.split("\n").slice(0, 7).join("\n").length + 1
  expect(b.lineCol()).toEqual({ line: 8, col: 1 })
  const before = b.point
  for (const ch of "0123456789") b.insert(ch)
  expect(b.dirty).toBe(true)

  b.undo()
  // Bug was: point jumped to (1,1) because undo did a full-buffer splice with no point restore.
  expect(b.lineCol().line).toBe(8)
  expect(b.dirty).toBe(true)

  for (let i = 0; i < 11; i++) b.undo() // 9 real + 2 no-op
  expect(b.text).toBe(text)
  expect(b.point).toBe(before)
  // Bug was: dirty stayed true even after restoring saved text.
  expect(b.dirty).toBe(false)

  b.redo()
  expect(b.dirty).toBe(true)
  expect(b.lineCol().line).toBe(8)
})

// t-3aed4969 + t-72bbff3d: BufferModel.save() owns the basic-save-buffer
// sequence — before-save-hook → backup~ on first write → write → after-save-hook —
// so write-file / find-alternate-file get hooks and backups without command-layer advice.
test("save() runs hooks and writes backup~ once, independent of caller", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-t-a934d978-"))
  try {
    const path = join(dir, "task.go")
    await writeFile(path, "package task\n")
    const b = await BufferModel.fromFile(path)
    b.point = b.text.length
    b.insert("var x int\n")

    const calls: string[] = []
    const ctx = { runHook: async (name: string) => { calls.push(name) } }
    await b.save(ctx)
    expect(calls).toEqual(["before-save-hook", "after-save-hook"])
    expect(await readFile(path + "~", "utf8")).toBe("package task\n")
    expect(b.dirty).toBe(false)

    b.insert("var y int\n")
    calls.length = 0
    await b.save(ctx)
    expect(calls).toEqual(["before-save-hook", "after-save-hook"])
    // backedUp gates: second save does not rewrite the backup.
    expect(await readFile(path + "~", "utf8")).toBe("package task\n")

    // makeBackupFiles=false suppresses backup for a fresh buffer.
    const path2 = join(dir, "other.go")
    await writeFile(path2, "orig")
    const b2 = await BufferModel.fromFile(path2)
    b2.insert("x")
    await b2.save({ makeBackupFiles: false })
    await expect(readFile(path2 + "~", "utf8")).rejects.toThrow()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// t-f9d1375e: uniquify lives in Editor (needs the buffer set); BufferModel keeps
// the bare basename so display-name disambiguation is non-destructive.
test("BufferModel.name stays the basename; uniquify is an editor-layer overlay", () => {
  const a = new BufferModel({ name: "task.go", path: "/a/go-cli/task/task.go", kind: "file" })
  const b = new BufferModel({ name: "task.go", path: "/a/jemacs/task/task.go", kind: "file" })
  expect(a.name).toBe("task.go")
  expect(b.name).toBe("task.go")
})
