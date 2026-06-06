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

test("findServerBinary prefers project node_modules over Emacs cache", () => {
  const workspaceBin = join(process.cwd(), "node_modules", ".bin", "typescript-language-server")
  if (!existsSync(workspaceBin)) return
  const fromEmacs = emacsLspNpmBinary("typescript-language-server")
  if (!fromEmacs) return
  expect(findServerBinary("typescript-language-server", join(process.cwd(), "src/main.ts"))).toBe(workspaceBin)
})

test("findServerBinary prefers JEMACS_HOME over Emacs cache for unrelated files", () => {
  const fromEmacs = emacsLspNpmBinary("typescript-language-server")
  if (!fromEmacs) return
  const homeBin = join(process.cwd(), "node_modules", ".bin", "typescript-language-server")
  if (!existsSync(homeBin)) return
  const previous = process.env.JEMACS_HOME
  process.env.JEMACS_HOME = process.cwd()
  try {
    expect(findServerBinary("typescript-language-server", "/tmp/no-project/file.ts")).toBe(homeBin)
  } finally {
    if (previous === undefined) delete process.env.JEMACS_HOME
    else process.env.JEMACS_HOME = previous
  }
})
