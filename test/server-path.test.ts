import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { emacsLspNpmBinary, findServerBinary } from "../src/lsp/server-path"

test("emacsLspNpmBinary matches lsp-mode install layout", () => {
  const expected = join(homedir(), ".emacs.d", ".cache", "lsp", "npm", "typescript-language-server", "bin", "typescript-language-server")
  const resolved = emacsLspNpmBinary("typescript-language-server")
  if (existsSync(expected)) {
    expect(resolved).toBe(expected)
  } else {
    expect(resolved).toBeNull()
  }
})

test("findServerBinary prefers Emacs cache when not on PATH", () => {
  const fromEmacs = emacsLspNpmBinary("typescript-language-server")
  if (!fromEmacs) return
  expect(findServerBinary("typescript-language-server", "/tmp")).toBe(fromEmacs)
})
