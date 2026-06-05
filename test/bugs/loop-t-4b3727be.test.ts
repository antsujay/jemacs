import { expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, readFile, utimes, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BufferModel } from "../../src/kernel/buffer"

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "jemacs-mtime-")) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const exists = (p: string) => access(p).then(() => true, () => false)

// t-4b3727be(b): editor.openFile revisit needs a cheap "is disk newer?" probe on
// BufferModel — verify-visited-file-modtime equivalent (files.el:2572).
test("verifyVisitedFileModtime: true when fresh, false after external write", async () => {
  const path = join(dir, "f.txt")
  await writeFile(path, "v1")
  const b = await BufferModel.fromFile(path)
  expect(await b.verifyVisitedFileModtime()).toBe(true)
  const future = Date.now() / 1000 + 60
  await utimes(path, future, future)
  expect(await b.verifyVisitedFileModtime()).toBe(false)
})

test("verifyVisitedFileModtime: true for non-file buffers and not-yet-existing files", async () => {
  const scratch = new BufferModel({ name: "*scratch*" })
  expect(await scratch.verifyVisitedFileModtime()).toBe(true)
  const fresh = new BufferModel({ name: "new.txt", path: join(dir, "new.txt"), kind: "file" })
  expect(await fresh.verifyVisitedFileModtime()).toBe(true)
})

// t-4b3727be(b): once openFile sees stale modtime it offers revert; BufferModel
// must own the reread so callers (revert-buffer, auto-revert, openFile) share
// one path that also refreshes visitedFileModtime.
test("revert: rereads disk, clears dirty, clamps point, refreshes modtime", async () => {
  const path = join(dir, "r.txt")
  await writeFile(path, "1234567890")
  const b = await BufferModel.fromFile(path)
  b.point = 10
  b.insert("abc")
  expect(b.dirty).toBe(true)
  await writeFile(path, "short")
  const future = Date.now() / 1000 + 60
  await utimes(path, future, future)
  await b.revert()
  expect(b.text).toBe("short")
  expect(b.dirty).toBe(false)
  expect(b.point).toBe(5) // clamped from 13
  expect(await b.verifyVisitedFileModtime()).toBe(true)
})

// Regression: existing revert paths forget to refresh visitedFileModtime, so a
// save() immediately after revert spuriously prompts "changed on disk".
test("revert then save: no spurious changed-on-disk prompt", async () => {
  const path = join(dir, "rs.txt")
  await writeFile(path, "a")
  const b = await BufferModel.fromFile(path)
  await writeFile(path, "bb")
  const future = Date.now() / 1000 + 60
  await utimes(path, future, future)
  await b.revert()
  b.point = 2
  b.insert("c")
  let prompted = false
  await b.save({ confirm: async () => { prompted = true; return true } })
  expect(prompted).toBe(false)
  expect(await readFile(path, "utf8")).toBe("bbc")
})

// t-72bbff3d: gate backup~ on make-backup-files (default on). SaveContext carries
// the resolved value so buffer.ts stays free of the runtime/custom cycle.
test("save: makeBackupFiles=false suppresses backup~", async () => {
  const path = join(dir, "nb.txt")
  await writeFile(path, "orig")
  const b = await BufferModel.fromFile(path)
  b.point = 4
  b.insert("!")
  await b.save({ makeBackupFiles: false })
  expect(await exists(path + "~")).toBe(false)
  expect(await readFile(path, "utf8")).toBe("orig!")
})

// revert resets the saved-state baseline: undoing past the revert point stays dirty.
test("revert: undo history baseline moves to reverted text", async () => {
  const path = join(dir, "u.txt")
  await writeFile(path, "base")
  const b = await BufferModel.fromFile(path)
  b.point = 4
  b.insert("X")
  await b.revert()
  expect(b.dirty).toBe(false)
  b.insert("Y")
  expect(b.dirty).toBe(true)
  b.undo()
  expect(b.text).toBe("base")
  expect(b.dirty).toBe(false)
})
