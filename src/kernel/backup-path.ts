import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"

/** Emacs `backup-directory-alist` entry: `(regexp . directory)`. */
export type BackupDirectoryEntry = [string, string | null]
export type BackupDirectoryAlist = BackupDirectoryEntry[]

function expandFileName(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

/** Resolve the backup path for `filePath` using Emacs `backup-directory-alist` rules.
 *  `undefined` → default `filePath~`; `null` → suppress backup for this file. */
export function resolveBackupPath(
  filePath: string,
  alist: BackupDirectoryAlist | undefined,
): string | null | undefined {
  if (!alist?.length) return undefined
  const absFile = resolve(filePath)
  for (const [pattern, directory] of alist) {
    if (!new RegExp(pattern).test(absFile)) continue
    if (directory == null) return null
    const dir = expandFileName(directory)
    if (isAbsolute(dir)) {
      return join(dir, absFile.replace(/\//g, "!") + "~")
    }
    return join(dirname(absFile), dir, basename(absFile) + "~")
  }
  return undefined
}
