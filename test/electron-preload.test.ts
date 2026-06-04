import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

test("electron preload bundle is CommonJS (no top-level import)", async () => {
  const preloadPath = join(import.meta.dirname, "../dist/electron/preload.js")
  let source: string
  try {
    source = await readFile(preloadPath, "utf8")
  } catch {
    const { $ } = await import("bun")
    await $`bun run scripts/build-electron.ts`.quiet()
    source = await readFile(preloadPath, "utf8")
  }
  expect(source.startsWith("import ")).toBe(false)
  expect(source.includes("contextBridge.exposeInMainWorld")).toBe(true)
  expect(source.includes('require("electron")') || source.includes("require('electron')")).toBe(true)
})
