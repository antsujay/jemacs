import { basename } from "node:path"
import type { Editor } from "../../src/kernel/editor"
import type { BufferModel } from "../../src/kernel/buffer"
import { defineMode } from "../../src/modes/mode"
import { Keymap } from "../../src/kernel/keymap"
import { spawnProcess } from "../../src/platform/runtime"
import { projectRoot } from "../project"

/** A file-level section in the status buffer; line ranges let s/u act on the diff body too. */
export type MagitEntry = {
  file: string
  staged: boolean
  startLine: number
  endLine: number
}

/** One @@-hunk's range in the status buffer plus a self-contained patch for `git apply --cached`. */
export type MagitHunk = {
  file: string
  staged: boolean
  startLine: number
  endLine: number
  patch: string
}

async function git(args: string[], cwd: string, stdin?: string): Promise<{ out: string; err: string; code: number | null }> {
  const proc = spawnProcess({
    cmd: ["git", ...args],
    cwd,
    stdin: stdin != null ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (stdin != null && proc.stdin) {
    proc.stdin.write(stdin)
    proc.stdin.end()
  }
  const [out, err] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
  ])
  const code = await proc.exited
  return { out, err, code }
}

type FileChange = { file: string; xy: string }

/** Minimal porcelain=v2 reader: just the XY state and path of ordinary/renamed/untracked entries. */
export function parsePorcelain(out: string): { branch: string | null; upstream: string | null; files: FileChange[] } {
  let branch: string | null = null
  let upstream: string | null = null
  const files: FileChange[] = []
  for (const line of out.split("\n")) {
    if (!line) continue
    if (line.startsWith("# branch.head ")) branch = line.slice("# branch.head ".length)
    else if (line.startsWith("# branch.upstream ")) upstream = line.slice("# branch.upstream ".length)
    else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ")
      const xy = parts[1] ?? ".."
      const file = line.startsWith("2 ")
        ? (parts.slice(9).join(" ").split("\t")[0] ?? "")
        : parts.slice(8).join(" ")
      if (file) files.push({ file, xy })
    } else if (line.startsWith("? ")) {
      files.push({ file: line.slice(2), xy: "??" })
    }
  }
  return { branch, upstream, files }
}

function changeLabel(code: string): string {
  switch (code) {
    case "M": return "modified  "
    case "A": return "new file  "
    case "D": return "deleted   "
    case "R": return "renamed   "
    case "?": return "untracked "
    default: return "modified  "
  }
}

export type DiffHunk = { header: string; lines: string[] }
export type FileDiff = { file: string; header: string[]; hunks: DiffHunk[] }

/** Split `git diff` output into per-file headers and per-hunk bodies, preserving enough to rebuild a patch. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = []
  let cur: FileDiff | null = null
  let hunk: DiffHunk | null = null
  for (const line of diff.split("\n")) {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (m) {
      cur = { file: m[2]!, header: [line], hunks: [] }
      files.push(cur)
      hunk = null
      continue
    }
    if (!cur) continue
    if (line.startsWith("@@")) {
      hunk = { header: line, lines: [] }
      cur.hunks.push(hunk)
    } else if (hunk && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\"))) {
      hunk.lines.push(line)
    } else if (!hunk) {
      cur.header.push(line)
    }
  }
  return files
}

function hunkPatch(fd: FileDiff, h: DiffHunk): string {
  return [...fd.header, h.header, ...h.lines, ""].join("\n")
}

export type MagitStatus = {
  root: string
  text: string
  entries: MagitEntry[]
  hunks: MagitHunk[]
}

export async function buildStatus(root: string): Promise<MagitStatus> {
  const [status, headMsg, unstagedDiff, stagedDiff, log] = await Promise.all([
    git(["status", "--porcelain=v2", "--branch"], root),
    git(["log", "-1", "--pretty=%s"], root),
    git(["diff"], root),
    git(["diff", "--cached"], root),
    git(["log", "-n", "10", "--pretty=%h %s"], root),
  ])
  const { branch, upstream, files } = parsePorcelain(status.out)
  const unstagedDiffs = new Map(parseDiff(unstagedDiff.out).map(d => [d.file, d]))
  const stagedDiffs = new Map(parseDiff(stagedDiff.out).map(d => [d.file, d]))

  const unstaged = files.filter(f => f.xy[1] !== "." && f.xy[1] !== undefined)
  const staged = files.filter(f => f.xy[0] !== "." && f.xy[0] !== "?")

  const lines: string[] = []
  const entries: MagitEntry[] = []
  const hunks: MagitHunk[] = []
  const push = (s: string) => lines.push(s)

  push(`Head:     ${branch ?? "(detached)"} ${headMsg.out.trim()}`)
  if (upstream) push(`Merge:    ${upstream}`)
  push("")

  const section = (title: string, items: FileChange[], isStaged: boolean, diffs: Map<string, FileDiff>) => {
    if (!items.length) return
    push(`${title} (${items.length})`)
    for (const f of items) {
      const code = isStaged ? f.xy[0]! : f.xy[1]!
      const start = lines.length
      push(`${changeLabel(code)} ${f.file}`)
      const fd = diffs.get(f.file)
      for (const h of fd?.hunks ?? []) {
        const hStart = lines.length
        push(h.header)
        for (const l of h.lines) push(l)
        hunks.push({
          file: f.file,
          staged: isStaged,
          startLine: hStart,
          endLine: lines.length - 1,
          patch: hunkPatch(fd!, h),
        })
      }
      entries.push({ file: f.file, staged: isStaged, startLine: start, endLine: lines.length - 1 })
    }
    push("")
  }
  section("Unstaged changes", unstaged, false, unstagedDiffs)
  section("Staged changes", staged, true, stagedDiffs)

  const commits = log.out.split("\n").filter(Boolean)
  if (commits.length) {
    push("Recent commits")
    for (const c of commits) push(c)
    push("")
  }

  return { root, text: lines.join("\n"), entries, hunks }
}

function lineAt(buffer: BufferModel): number {
  return buffer.text.slice(0, buffer.point).split("\n").length - 1
}

export function entryAtPoint(buffer: BufferModel): MagitEntry | null {
  const entries = buffer.locals.get("magit-entries") as MagitEntry[] | undefined
  if (!entries) return null
  const line = lineAt(buffer)
  return entries.find(e => line >= e.startLine && line <= e.endLine) ?? null
}

export function hunkAtPoint(buffer: BufferModel): MagitHunk | null {
  const hunks = buffer.locals.get("magit-hunks") as MagitHunk[] | undefined
  if (!hunks) return null
  const line = lineAt(buffer)
  return hunks.find(h => line >= h.startLine && line <= h.endLine) ?? null
}

async function refresh(editor: Editor, root: string, point?: number): Promise<BufferModel> {
  const status = await buildStatus(root)
  const name = `*magit: ${basename(root)}*`
  const prev = [...editor.buffers.values()].find(b => b.name === name)
  // Preserving the byte offset is only sound when the section layout is stable
  // (g/s/u). Callers that reshape the buffer — commit drops the whole Staged
  // section — pass an explicit point so we don't land mid-word (t-6bbb608e).
  const keepPoint = point ?? prev?.point ?? 0
  const buf = editor.scratch(name, status.text, "magit-status")
  buf.readOnly = true
  buf.path = root
  buf.locals.set("magit-root", root)
  buf.locals.set("magit-entries", status.entries)
  buf.locals.set("magit-hunks", status.hunks)
  buf.point = Math.min(keepPoint, buf.text.length)
  return buf
}

function magitRoot(buffer: BufferModel): string | null {
  return (buffer.locals.get("magit-root") as string | undefined) ?? null
}

export function install(editor: Editor): void {
  const statusMap = new Keymap("magit-status-map")
  statusMap.bind("s", "magit-stage")
  statusMap.bind("u", "magit-unstage")
  statusMap.bind("g", "magit-refresh")
  statusMap.bind("c c", "magit-commit")
  statusMap.bind("q", "magit-bury-buffer")
  defineMode({ name: "magit-status", parent: "text", keymap: statusMap })

  const commitMap = new Keymap("magit-commit-map")
  commitMap.bind("C-c C-c", "magit-commit-finish")
  defineMode({ name: "magit-commit", parent: "text", keymap: commitMap })

  editor.command("magit-status", async ({ editor, buffer, args }) => {
    const start = args[0] ?? buffer.directory() ?? process.cwd()
    const root = await projectRoot(start)
    if (!root) {
      editor.message(`Not inside a Git repository: ${start}`)
      return
    }
    await refresh(editor, root)
  }, "Open the Magit status buffer for the current repository.")

  editor.command("magit-refresh", async ({ editor, buffer }) => {
    const root = magitRoot(buffer)
    if (!root) return editor.run("magit-status")
    await refresh(editor, root)
  }, "Refresh the current Magit status buffer.")

  editor.command("magit-stage", async ({ editor, buffer }) => {
    const root = magitRoot(buffer)
    if (!root) {
      editor.message("Nothing to stage at point")
      return
    }
    const hunk = hunkAtPoint(buffer)
    if (hunk && !hunk.staged) {
      const { err, code } = await git(["apply", "--cached", "-"], root, hunk.patch)
      if (code !== 0) {
        editor.message(`git apply failed: ${err.trim()}`)
        return
      }
      await refresh(editor, root)
      editor.message(`Staged hunk in ${hunk.file}`)
      return
    }
    const entry = entryAtPoint(buffer)
    if (!entry || entry.staged) {
      editor.message("Nothing to stage at point")
      return
    }
    await git(["add", "--", entry.file], root)
    await refresh(editor, root)
    editor.message(`Staged ${entry.file}`)
  }, "Stage the hunk or file at point.")

  editor.command("magit-unstage", async ({ editor, buffer }) => {
    const root = magitRoot(buffer)
    if (!root) {
      editor.message("Nothing to unstage at point")
      return
    }
    const hunk = hunkAtPoint(buffer)
    if (hunk && hunk.staged) {
      const { err, code } = await git(["apply", "--cached", "--reverse", "-"], root, hunk.patch)
      if (code !== 0) {
        editor.message(`git apply failed: ${err.trim()}`)
        return
      }
      await refresh(editor, root)
      editor.message(`Unstaged hunk in ${hunk.file}`)
      return
    }
    const entry = entryAtPoint(buffer)
    if (!entry || !entry.staged) {
      editor.message("Nothing to unstage at point")
      return
    }
    await git(["restore", "--staged", "--", entry.file], root)
    await refresh(editor, root)
    editor.message(`Unstaged ${entry.file}`)
  }, "Unstage the hunk or file at point.")

  editor.command("magit-commit", async ({ editor, buffer }) => {
    const root = magitRoot(buffer)
    if (!root) {
      editor.message("Not in a Magit buffer")
      return
    }
    const winconf = editor.currentWindowConfiguration()
    const { out: diff } = await git(["diff", "--cached"], root)
    const buf = editor.scratch("*COMMIT_EDITMSG*", "", "magit-commit")
    buf.locals.set("magit-root", root)
    buf.locals.set("magit-winconf", winconf)
    buf.point = 0
    // Show what's being committed in a split, like real magit.
    const msgWindow = editor.selectedWindowId
    editor.splitWindowBelow()
    const diffBuf = editor.scratch("*magit-diff: staged*", diff || "(nothing staged)\n", "text")
    diffBuf.readOnly = true
    diffBuf.point = 0
    editor.selectWindow(msgWindow)
    editor.message("Type C-c C-c to finish")
  }, "Open a buffer to write a commit message for staged changes.")

  editor.command("magit-commit-finish", async ({ editor, buffer }) => {
    const root = magitRoot(buffer)
    if (!root || buffer.mode !== "magit-commit") {
      editor.message("Not in a commit message buffer")
      return
    }
    const msg = buffer.text
    if (!msg.trim()) {
      editor.message("Aborting commit due to empty message")
      return
    }
    const { err, code } = await git(["commit", "-F", "-"], root, msg)
    if (code !== 0) {
      editor.message(`git commit failed: ${err.trim()}`)
      return
    }
    const winconf = buffer.locals.get("magit-winconf") as ReturnType<Editor["currentWindowConfiguration"]> | undefined
    editor.killBuffer(buffer.id)
    editor.killBuffer("*magit-diff: staged*")
    if (winconf) editor.restoreWindowConfiguration(winconf)
    await refresh(editor, root, 0)
    editor.message("Committed")
  }, "Finish the commit using the current buffer as the message.")

  editor.command("magit-bury-buffer", ({ editor }) => {
    editor.previousBuffer()
  }, "Bury the Magit status buffer.")

  editor.key("C-x g", "magit-status")
}
