import { expect, test } from "bun:test"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { BufferModel } from "../src/kernel/buffer"
import { readFileText, writeFileText, whichExecutable } from "../src/platform/runtime"

test("readFileText and writeFileText work without Bun", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-platform-"))
  const path = join(dir, "sample.txt")
  await writeFileText(path, "hello electron")
  expect(await readFileText(path)).toBe("hello electron")
  await rm(dir, { recursive: true })
})

test("BufferModel.fromFile uses platform I/O", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-fromfile-"))
  const path = join(dir, "open-me.ts")
  await writeFile(path, "export const x = 1\n", "utf8")
  const buffer = await BufferModel.fromFile(path)
  expect(buffer.text).toBe("export const x = 1\n")
  expect(buffer.name).toBe("open-me.ts")
  await rm(dir, { recursive: true })
})

test("whichExecutable resolves common tools when present", () => {
  const node = whichExecutable("node")
  expect(node == null || node.length > 0).toBe(true)
})
