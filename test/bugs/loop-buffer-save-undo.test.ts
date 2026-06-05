import { expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, readFile, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BufferModel } from "../../src/kernel/buffer"

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "jemacs-buf-")) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

// inbox13: undo restores point from snapshot, not clamped end-of-buffer.
test("undo restores point to where it was before the edit", () => {
  const b = new BufferModel({ name: "x", text: "hello world" })
  b.point = 5
  b.insert("___")
  expect(b.point).toBe(8)
  b.point = 0
  b.undo()
  expect(b.text).toBe("hello world")
  expect(b.point).toBe(5)
})

// inbox13: undo back to saved state clears dirty; redo away sets it.
test("dirty flag tracks distance from saved state across undo/redo", async () => {
  const path = join(dir, "a.txt")
  await writeFile(path, "one")
  const b = await BufferModel.fromFile(path)
  expect(b.dirty).toBe(false)
  b.point = 3
  b.insert(" two")
  expect(b.dirty).toBe(true)
  b.undo()
  expect(b.text).toBe("one")
  expect(b.dirty).toBe(false)
  b.redo()
  expect(b.dirty).toBe(true)
  await b.save()
  expect(b.dirty).toBe(false)
  b.undo()
  expect(b.dirty).toBe(true)
  b.redo()
  expect(b.dirty).toBe(false)
})

// inbox36: save() runs before-save-hook and after-save-hook itself.
test("save() awaits before/after-save-hook via ctx.runHook", async () => {
  const path = join(dir, "h.txt")
  const b = new BufferModel({ name: "h.txt", path, text: "x", kind: "file" })
  const calls: string[] = []
  await b.save({ runHook: async (name) => { calls.push(name) } })
  expect(calls).toEqual(["before-save-hook", "after-save-hook"])
})

// inbox37: first save copies disk file to path~ before overwriting.
test("save() writes a backup~ on first save only", async () => {
  const path = join(dir, "b.txt")
  await writeFile(path, "original")
  const b = await BufferModel.fromFile(path)
  b.point = 8
  b.insert("!")
  await b.save()
  expect(await readFile(path + "~", "utf8")).toBe("original")
  expect(await readFile(path, "utf8")).toBe("original!")
  b.insert("!")
  await b.save()
  expect(await readFile(path + "~", "utf8")).toBe("original")
})

// inbox34: save() refuses to clobber a file modified on disk since visit.
test("save() detects disk modification since visit", async () => {
  const path = join(dir, "c.txt")
  await writeFile(path, "v1")
  const b = await BufferModel.fromFile(path)
  b.point = 2
  b.insert("x")
  const future = Date.now() / 1000 + 60
  await utimes(path, future, future)
  await expect(b.save()).rejects.toThrow(/changed on disk/)
  await expect(b.save({ confirm: async () => true })).resolves.toBeUndefined()
  expect(await readFile(path, "utf8")).toBe("v1x")
})
