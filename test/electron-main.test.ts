import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

test("electron main bundle does not import bun: built-ins", async () => {
  const mainPath = join(import.meta.dirname, "../dist/main-electron.js")
  let source: string
  try {
    source = await readFile(mainPath, "utf8")
  } catch {
    const { $ } = await import("bun")
    await $`bun run scripts/build-electron.ts`.quiet()
    source = await readFile(mainPath, "utf8")
  }
  expect(source.includes("bun:ffi")).toBe(false)
  expect(source.includes("bun:")).toBe(false)
})
