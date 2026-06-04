import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import type { BufferModel } from "../kernel/buffer"
import { whichExecutable } from "../platform/runtime"

/** Same layout as lsp-mode `lsp--npm-dependency-path` (~/.emacs.d/.cache/lsp/npm/…/bin/). */
export function emacsLspNpmBinary(packageName: string, binaryName = packageName): string | null {
  const candidate = join(
    homedir(),
    ".emacs.d",
    ".cache",
    "lsp",
    "npm",
    packageName,
    "bin",
    binaryName,
  )
  return existsSync(candidate) ? candidate : null
}

/** Resolve an LSP server executable: PATH, Emacs lsp-mode cache, then `node_modules/.bin` walking up. */
export function findServerBinary(name: string, searchFrom?: string): string | null {
  const onPath = whichExecutable(name)
  if (onPath) return onPath

  const fromEmacs = emacsLspNpmBinary(name)
  if (fromEmacs) return fromEmacs

  let dir = searchFrom ? resolve(searchFrom) : process.cwd()
  if (searchFrom) {
    try {
      if (statSync(dir).isFile()) dir = dirname(dir)
    } catch {
      dir = dirname(dir)
    }
  }
  const root = resolve("/")
  while (true) {
    const candidate = join(dir, "node_modules", ".bin", name)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir || dir === root) break
    dir = parent
  }
  return null
}

export function searchRootForBuffer(buffer?: BufferModel): string {
  if (buffer?.path) return dirname(resolve(buffer.path))
  return process.cwd()
}

export function serverBinaryAvailable(name: string, buffer?: BufferModel): boolean {
  return findServerBinary(name, searchRootForBuffer(buffer)) != null
}
