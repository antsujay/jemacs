import { resolve } from "node:path"
import type { Editor } from "../kernel/editor"
import type { BufferModel } from "../kernel/buffer"
import { Keymap } from "../kernel/keymap"
import { spawnProcess } from "../platform/runtime"
import { defineMode, type TextSpan } from "./mode"

export type DiffHunkStyle = "unified" | "context" | "normal"

export type DiffHunk = {
  style: DiffHunkStyle
  startLine: number
  endLine: number
  oldStart?: number
  oldCount?: number
  newStart?: number
  newCount?: number
}

export type DiffFile = {
  startLine: number
  endLine: number
  oldFile?: string
  newFile?: string
  hunks: DiffHunk[]
}

type Line = { text: string; start: number; end: number }

export function installDiffMode(): void {
  const keymap = new Keymap("diff-mode-map")
  for (const [key, command] of [
    ["n", "diff-hunk-next"],
    ["S-n", "diff-file-next"],
    ["p", "diff-hunk-prev"],
    ["S-p", "diff-file-prev"],
    ["tab", "diff-hunk-next"],
    ["backtab", "diff-hunk-prev"],
    ["k", "diff-hunk-kill"],
    ["S-k", "diff-file-kill"],
    ["}", "diff-file-next"],
    ["{", "diff-file-prev"],
    ["return", "diff-goto-source"],
    ["RET", "diff-goto-source"],
    ["o", "diff-goto-source"],
    ["w", "diff-kill-ring-save"],
    ["S-a", "diff-ediff-patch"],
    ["r", "diff-restrict-view"],
    ["S-r", "diff-reverse-direction"],
    ["s", "diff-split-hunk"],
    ["u", "diff-revert-and-kill-hunk"],
    ["@", "diff-revert-and-kill-hunk"],
    ["C-c C-c", "diff-goto-source"],
    ["C-x 4 A", "diff-add-change-log-entries-other-window"],
    ["C-c C-a", "diff-apply-hunk"],
    ["C-c M-u", "diff-revert-and-kill-hunk"],
    ["C-c C-m a", "diff-apply-buffer"],
    ["C-c C-m n", "diff-delete-other-hunks"],
    ["C-c C-e", "diff-ediff-patch"],
    ["C-c C-n", "diff-restrict-view"],
    ["C-c C-s", "diff-split-hunk"],
    ["C-c C-t", "diff-test-hunk"],
    ["C-c C-r", "diff-reverse-direction"],
    ["C-c C-u", "diff-context->unified"],
    ["C-c C-d", "diff-unified->context"],
    ["C-c C-w", "diff-ignore-whitespace-hunk"],
    ["C-c C-l", "diff-refresh-hunk"],
    ["C-c C-b", "diff-refine-hunk"],
  ] as const) keymap.bind(key, command)
  defineMode({
    name: "diff-mode",
    parent: "text",
    keymap,
    fontLock: diffFontLock,
    beginningOfDefun: diffBeginningOfFileAndJunk,
    endOfDefun: diffEndOfFile,
  })
}

export function installDiffCommands(editor: Editor): void {
  editor.command("diff-hunk-next", ({ buffer, prefixArgument }) => {
    moveToHunk(buffer, prefixCount(prefixArgument), 1)
  }, "Move to the next diff hunk.")

  editor.command("diff-hunk-prev", ({ buffer, prefixArgument }) => {
    moveToHunk(buffer, prefixCount(prefixArgument), -1)
  }, "Move to the previous diff hunk.")

  editor.command("diff-file-next", ({ buffer, prefixArgument }) => {
    moveToFile(buffer, prefixCount(prefixArgument), 1)
  }, "Move to the next file in the diff.")

  editor.command("diff-file-prev", ({ buffer, prefixArgument }) => {
    moveToFile(buffer, prefixCount(prefixArgument), -1)
  }, "Move to the previous file in the diff.")

  editor.command("diff-hunk-kill", ({ buffer, editor }) => {
    const hunk = diffHunkAtPoint(buffer)
    if (!hunk) return editor.message("No hunk at point")
    deleteLines(buffer, hunk.startLine, hunk.endLine)
  }, "Kill the current diff hunk.")

  editor.command("diff-file-kill", ({ buffer, editor }) => {
    const file = diffFileAtPoint(buffer)
    if (!file) return editor.message("No file at point")
    deleteLines(buffer, file.startLine, file.endLine)
  }, "Kill the current file's diff.")

  editor.command("diff-delete-other-hunks", ({ buffer, editor }) => {
    const keep = diffHunkAtPoint(buffer)
    if (!keep) return editor.message("No hunk at point")
    const lines = lineInfo(buffer)
    const kept = lines.slice(keep.startLine, keep.endLine + 1).map(l => l.text).join("\n")
    buffer.setText(kept + (kept.endsWith("\n") ? "" : "\n"))
  }, "Delete hunks other than the current hunk.")

  editor.command("diff-reverse-direction", ({ buffer }) => {
    reverseDiffDirection(buffer)
  }, "Reverse the direction of the diff.")

  editor.command("diff-goto-source", async ({ editor, buffer }) => {
    const loc = sourceLocationAtPoint(buffer)
    if (!loc) return editor.message("No source location at point")
    const file = resolve(diffDefaultDirectory(buffer), loc.file)
    const source = await editor.openFile(file)
    const line = Math.max(0, loc.line - 1)
    source.point = source.lineBounds(Math.min(line, source.lineCount - 1))[0]
  }, "Visit the source location corresponding to point.")

  editor.command("diff-apply-hunk", async ({ editor, buffer }) => {
    const patch = patchAtPoint(buffer)
    if (!patch) return editor.message("No hunk at point")
    await applyPatchText(editor, buffer, patch, false, false)
  }, "Apply the current hunk.")

  editor.command("diff-test-hunk", async ({ editor, buffer }) => {
    const patch = patchAtPoint(buffer)
    if (!patch) return editor.message("No hunk at point")
    await applyPatchText(editor, buffer, patch, false, true)
  }, "Test whether the current hunk applies.")

  editor.command("diff-apply-buffer", async ({ editor, buffer }) => {
    await applyPatchText(editor, buffer, buffer.text, false, false)
  }, "Apply all hunks in the current diff buffer.")

  editor.command("diff-revert-and-kill-hunk", async ({ editor, buffer }) => {
    const hunk = diffHunkAtPoint(buffer)
    const patch = patchAtPoint(buffer)
    if (!hunk || !patch) return editor.message("No hunk at point")
    const ok = await applyPatchText(editor, buffer, patch, true, false)
    if (ok) deleteLines(buffer, hunk.startLine, hunk.endLine)
  }, "Reverse-apply and then kill the current hunk.")

  for (const name of [
    "diff-restrict-view",
    "diff-split-hunk",
    "diff-ediff-patch",
    "diff-context->unified",
    "diff-unified->context",
    "diff-ignore-whitespace-hunk",
    "diff-refresh-hunk",
    "diff-refine-hunk",
    "diff-add-change-log-entries-other-window",
    "diff-kill-ring-save",
  ]) {
    editor.command(name, ({ editor }) => {
      editor.message(`${name} is not implemented in jemacs yet`)
    })
  }
}

export function diffFontLock(buffer: BufferModel): TextSpan[] {
  return diffFontLockText(buffer.text)
}

export function diffFontLockText(text: string): TextSpan[] {
  const spans: TextSpan[] = []
  for (const line of textLines(text)) {
    const s = line.start
    const e = line.end
    const text = line.text
    if (!text) continue
    const hunk = /^(@@ .+? @@)(.*)$/.exec(text)
    if (hunk) {
      spans.push({ start: s, end: s + hunk[1]!.length, face: "diffHunkHeader" })
      if (hunk[2]) spans.push({ start: s + hunk[1]!.length, end: e, face: "diffFunction" })
    } else if (/^\*{15}/.test(text) || /^\*\*\* .+ \*\*\*\*$/.test(text) || /^---$/.test(text) || /^[0-9,]+[acd][0-9,]+$/.test(text)) {
      spans.push({ start: s, end: e, face: "diffHunkHeader" })
    } else if (/^(---|\+\+\+|\*\*\*) /.test(text)) {
      spans.push({ start: s, end: e, face: "diffFileHeader" })
    } else if (/^(Index|revno): /.test(text) || /^index .*\.{2}/.test(text)) {
      spans.push({ start: s, end: e, face: "diffIndex" })
    } else if (/^(diff |new file mode |deleted file mode )/.test(text)) {
      spans.push({ start: s, end: e, face: "diffHeader" })
    } else if (/^Only in /.test(text) || /^Binary files .* differ$/.test(text)) {
      spans.push({ start: s, end: e, face: "diffNonexistent" })
    } else if (text.startsWith("+")) {
      spans.push({ start: s, end: e, face: "diffAdded" })
    } else if (text.startsWith("-")) {
      spans.push({ start: s, end: e, face: "diffRemoved" })
    } else if (text.startsWith("!")) {
      spans.push({ start: s, end: e, face: "diffChanged" })
    } else if (!/^[-=+*!<>#]/.test(text)) {
      spans.push({ start: s, end: e, face: "diffContext" })
    }
  }
  return spans
}

export function parseDiffBuffer(buffer: BufferModel): DiffFile[] {
  const lines = lineInfo(buffer)
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  const ensureFile = (line: number): DiffFile => {
    if (!current) {
      current = { startLine: line, endLine: line, hunks: [] }
      files.push(current)
    }
    return current
  }

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.text
    if (/^diff --git /.test(text) || /^Index: /.test(text) || /^Only in /.test(text) || /^Binary files /.test(text)) {
      if (current) current.endLine = Math.max(current.endLine, i - 1)
      current = { startLine: i, endLine: i, hunks: [] }
      files.push(current)
      continue
    }
    const oldFile = /^(?:---|\*\*\*)\s+(.+?)(?:\t| \d| \*\*\*\*|$)/.exec(text)
    if (oldFile) {
      const file = ensureFile(i)
      if (text.startsWith("---")) file.oldFile = cleanDiffPath(oldFile[1]!)
      else if (!file.oldFile) file.oldFile = cleanDiffPath(oldFile[1]!)
      file.endLine = i
      continue
    }
    const newFile = /^\+\+\+\s+(.+?)(?:\t| \d|$)/.exec(text)
    if (newFile) {
      const file = ensureFile(i)
      file.newFile = cleanDiffPath(newFile[1]!)
      file.endLine = i
      continue
    }
    const unified = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(text)
    if (unified) {
      const file = ensureFile(i)
      const hunk: DiffHunk = {
        style: "unified",
        startLine: i,
        endLine: i,
        oldStart: Number(unified[1]),
        oldCount: unified[2] ? Number(unified[2]) : 1,
        newStart: Number(unified[3]),
        newCount: unified[4] ? Number(unified[4]) : 1,
      }
      file.hunks.push(hunk)
      file.endLine = i
      continue
    }
    const normal = /^(\d+)(?:,\d+)?[acd](\d+)(?:,\d+)?$/.exec(text)
    if (normal) {
      const file = ensureFile(i)
      file.hunks.push({ style: "normal", startLine: i, endLine: i, oldStart: Number(normal[1]), newStart: Number(normal[2]) })
      file.endLine = i
      continue
    }
    if (/^\*{15}/.test(text) || /^\*\*\* \d+/.test(text)) {
      const file = ensureFile(i)
      file.hunks.push({ style: "context", startLine: i, endLine: i })
      file.endLine = i
      continue
    }
    if (current) current.endLine = i
    const lastHunk = current?.hunks.at(-1)
    if (lastHunk && !isFileHeaderLine(text, lastHunk.style)) lastHunk.endLine = i
  }
  if (current) current.endLine = lines.length - 1
  return files
}

export function diffHunkAtPoint(buffer: BufferModel): DiffHunk | null {
  const line = buffer.lineAt(buffer.point)
  for (const file of parseDiffBuffer(buffer)) {
    for (const hunk of file.hunks) {
      if (line >= hunk.startLine && line <= hunk.endLine) return hunk
    }
  }
  return null
}

export function diffFileAtPoint(buffer: BufferModel): DiffFile | null {
  const line = buffer.lineAt(buffer.point)
  return parseDiffBuffer(buffer).find(file => line >= file.startLine && line <= file.endLine) ?? null
}

function diffBeginningOfFileAndJunk(buffer: BufferModel): boolean {
  const file = diffFileAtPoint(buffer)
  if (!file) return false
  buffer.point = lineInfo(buffer)[file.startLine]?.start ?? 0
  return true
}

function diffEndOfFile(buffer: BufferModel): boolean {
  const file = diffFileAtPoint(buffer)
  if (!file) return false
  buffer.point = lineInfo(buffer)[file.endLine]?.end ?? buffer.text.length
  return true
}

function moveToHunk(buffer: BufferModel, count: number, dir: 1 | -1): void {
  const hunks = parseDiffBuffer(buffer).flatMap(file => file.hunks).sort((a, b) => a.startLine - b.startLine)
  if (!hunks.length) return
  const line = buffer.lineAt(buffer.point)
  let idx = dir > 0
    ? hunks.findIndex(h => h.startLine > line)
    : findLastIndex(hunks, h => h.startLine < line)
  if (idx < 0) idx = dir > 0 ? hunks.length - 1 : 0
  idx = Math.max(0, Math.min(hunks.length - 1, idx + dir * (Math.max(1, count) - 1)))
  buffer.point = lineInfo(buffer)[hunks[idx]!.startLine]?.start ?? buffer.point
}

function moveToFile(buffer: BufferModel, count: number, dir: 1 | -1): void {
  const files = parseDiffBuffer(buffer).sort((a, b) => a.startLine - b.startLine)
  if (!files.length) return
  const line = buffer.lineAt(buffer.point)
  const current = files.findIndex(f => line >= f.startLine && line <= f.endLine)
  let idx = current >= 0
    ? current + dir * Math.max(1, count)
    : dir > 0
      ? files.findIndex(f => f.startLine > line)
      : findLastIndex(files, f => f.endLine < line)
  if (idx < 0) idx = dir > 0 ? files.length - 1 : 0
  if (current < 0) idx = idx + dir * (Math.max(1, count) - 1)
  idx = Math.max(0, Math.min(files.length - 1, idx))
  buffer.point = lineInfo(buffer)[files[idx]!.startLine]?.start ?? buffer.point
}

function sourceLocationAtPoint(buffer: BufferModel): { file: string; line: number } | null {
  const file = diffFileAtPoint(buffer)
  const hunk = diffHunkAtPoint(buffer)
  if (!file || !hunk) return null
  const target = file.newFile && file.newFile !== "/dev/null" ? file.newFile : file.oldFile
  if (!target) return null
  let line = hunk.newStart ?? hunk.oldStart ?? 1
  const here = buffer.lineAt(buffer.point)
  const lines = lineInfo(buffer)
  for (let i = hunk.startLine + 1; i <= Math.min(here, hunk.endLine); i++) {
    const text = lines[i]?.text ?? ""
    if (hunk.style === "unified") {
      if (!text.startsWith("-")) line++
    } else if (!text.startsWith("***") && !text.startsWith("---") && !text.startsWith("-")) {
      line++
    }
  }
  return { file: target, line }
}

function patchAtPoint(buffer: BufferModel): string | null {
  const file = diffFileAtPoint(buffer)
  const hunk = diffHunkAtPoint(buffer)
  if (!file || !hunk) return null
  const lines = lineInfo(buffer)
  const header = lines.slice(file.startLine, hunk.startLine)
    .filter(line => !/^@@|^\*{15}|^[0-9,]+[acd]/.test(line.text))
    .map(line => line.text)
  const body = lines.slice(hunk.startLine, hunk.endLine + 1).map(line => line.text)
  return [...header, ...body, ""].join("\n")
}

async function applyPatchText(editor: Editor, buffer: BufferModel, patch: string, reverse: boolean, check: boolean): Promise<boolean> {
  const args = ["apply", ...(check ? ["--check"] : []), ...(reverse ? ["--reverse"] : []), "-"]
  const proc = spawnProcess({
    cmd: ["git", ...args],
    cwd: diffDefaultDirectory(buffer),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  proc.stdin?.write(patch)
  proc.stdin?.end()
  const err = proc.stderr ? await new Response(proc.stderr).text() : ""
  const code = await proc.exited
  if (code === 0) {
    editor.message(check ? "Patch applies cleanly" : "Applied patch")
    return true
  }
  editor.message(`git apply failed: ${err.trim()}`)
  return false
}

function reverseDiffDirection(buffer: BufferModel): void {
  const next = lineInfo(buffer).map(line => {
    const text = line.text
    const git = /^diff --git a\/(.+) b\/(.+)$/.exec(text)
    if (git) return `diff --git a/${git[2]} b/${git[1]}`
    if (text.startsWith("--- ")) return "+++ " + text.slice(4)
    if (text.startsWith("+++ ")) return "--- " + text.slice(4)
    if (text.startsWith("*** ")) return "--- " + text.slice(4)
    const unified = /^@@\s+-(\d+(?:,\d+)?)\s+\+(\d+(?:,\d+)?)\s+@@(.*)$/.exec(text)
    if (unified) return `@@ -${unified[2]} +${unified[1]} @@${unified[3]}`
    if (text.startsWith("+")) return "-" + text.slice(1)
    if (text.startsWith("-")) return "+" + text.slice(1)
    if (text.startsWith("new file mode ")) return text.replace(/^new/, "deleted")
    if (text.startsWith("deleted file mode ")) return text.replace(/^deleted/, "new")
    return text
  }).join("\n")
  buffer.setText(next)
}

function deleteLines(buffer: BufferModel, startLine: number, endLine: number): void {
  const lines = lineInfo(buffer)
  const start = lines[startLine]?.start ?? 0
  const end = endLine + 1 < lines.length ? lines[endLine + 1]!.start : buffer.text.length
  buffer.deleteRange(start, end)
}

function diffDefaultDirectory(buffer: BufferModel): string {
  const local = buffer.locals.get("diff-default-directory") as string | undefined
  return local ?? buffer.directory() ?? process.cwd()
}

function cleanDiffPath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === "/dev/null") return trimmed
  return trimmed.replace(/^[ab]\//, "")
}

function isFileHeaderLine(text: string, style: DiffHunkStyle): boolean {
  if (style === "unified") return /^diff --git |^Index: |^--- |^\+\+\+ /.test(text)
  return /^diff --git |^Index: /.test(text)
}

function lineInfo(buffer: BufferModel): Line[] {
  const lines: Line[] = []
  for (let i = 0; i < buffer.lineCount; i++) {
    const [start, end] = buffer.lineBounds(i)
    lines.push({ text: buffer.text.slice(start, end), start, end })
  }
  return lines
}

function textLines(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (const part of text.split("\n")) {
    const end = start + part.length
    lines.push({ text: part, start, end })
    start = end + 1
  }
  return lines
}

function prefixCount(prefix: unknown): number {
  if (typeof prefix === "number" && Number.isFinite(prefix)) return Math.trunc(Math.abs(prefix))
  return 1
}

function findLastIndex<T>(items: T[], pred: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i]!)) return i
  return -1
}
