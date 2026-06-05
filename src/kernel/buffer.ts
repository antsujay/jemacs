import { dirname, basename } from "node:path"
import { copyFile, stat } from "node:fs/promises"
import { fileExists, readFileText, writeFileText } from "../platform/runtime"
import { isTransientMarkModeEnabled } from "./transient-mark"

export type BufferKind = "file" | "directory" | "scratch" | "messages" | "inspector" | "minibuffer" | "grep"

/** Editor capabilities save() needs, typed structurally to avoid the buffer↔editor cycle. */
export type SaveContext = {
  runHook?(name: string, buffer: BufferModel): Promise<void>
  confirm?(prompt: string): Promise<boolean>
  force?: boolean
  /** Resolved make-backup-files; the defcustom lives at the command layer to keep buffer.ts cycle-free. */
  makeBackupFiles?: boolean
}

type Op = { from: number; to: number; removed: string; inserted: string; point: number }
type UndoNode = { ops: Op[]; parent: UndoNode | null; children: UndoNode[] }

export class BufferModel {
  readonly id: string
  name: string
  path?: string
  kind: BufferKind
  private _text: string
  private _point = 0
  goalColumn: number | null = null
  mark: number | null = null
  markActive = false
  dirty = false
  readOnly = false
  mode = "text"
  /** mtimeMs of the visited file at last load/save; undefined if never read from disk. */
  visitedFileModtime?: number
  readonly minorModes = new Set<string>()
  readonly locals = new Map<string, unknown>()
  onTextChange?: (event: { start: number; end: number; text: string }) => void
  private undoRoot: UndoNode = { ops: [], parent: null, children: [] }
  private undoCur: UndoNode = this.undoRoot
  /** Tree node at which text matches disk. */
  private savedNode: UndoNode = this.undoRoot
  private backedUp = false

  constructor(args: { id?: string; name: string; text?: string; path?: string; kind?: BufferKind; mode?: string }) {
    this.id = args.id ?? crypto.randomUUID()
    this.name = args.name
    this._text = args.text ?? ""
    this.path = args.path
    this.kind = args.kind ?? (args.path ? "file" : "scratch")
    this.mode = args.mode ?? inferMode(args.path ?? args.name)
  }

  static async fromFile(path: string): Promise<BufferModel> {
    const exists = await fileExists(path)
    const text = exists ? await readFileText(path) : ""
    const buf = new BufferModel({ name: basename(path), path, text, kind: "file", mode: inferMode(path) })
    if (exists) buf.visitedFileModtime = await fileModtime(path)
    return buf
  }

  directory(): string | undefined {
    if (!this.path) return undefined
    if (this.kind === "directory") return this.path
    return dirname(this.path)
  }

  lineCol(): { line: number; col: number } {
    const before = this.text.slice(0, this.point)
    const lines = before.split("\n")
    return { line: lines.length, col: lines.at(-1)!.length + 1 }
  }

  get text(): string { return this._text }

  /** The single mutation funnel. Every text change routes through here so the
   *  invariant chain (assertWritable → snapshot → onTextChange → mutate →
   *  clamp point → adjust+clamp mark → deactivateMark) holds for all callers. */
  private _splice(from: number, to: number, repl: string, opts: { markDirty?: boolean; snapshot?: boolean } = {}): string {
    const len = this._text.length
    const a = clamp(Math.min(from, to), 0, len)
    const b = clamp(Math.max(from, to), 0, len)
    const markDirty = opts.markDirty ?? true
    if (a === b && !repl) return ""
    this.assertWritable(markDirty)
    const removed = this._text.slice(a, b)
    if (opts.snapshot ?? true) this.record(a, b, removed, repl)
    this.onTextChange?.({ start: a, end: b, text: repl })
    this._text = this._text.slice(0, a) + repl + this._text.slice(b)
    this._point = clamp(this._point <= a ? this._point : this._point >= b ? this._point + repl.length - (b - a) : a, 0, this._text.length)
    this.adjustMark(a, b, repl.length)
    this.deactivateMark()
    if (markDirty) this.dirty = true
    return removed
  }

  setText(text: string, markDirty = true, snapshot = true): void {
    this._splice(0, this._text.length, text, { markDirty, snapshot })
  }

  /** Append without snapshot/dirty — for *messages*, *compilation* streaming. */
  append(s: string): void {
    this._splice(this._text.length, this._text.length, s, { markDirty: false, snapshot: false })
  }

  insert(s: string): void {
    if (!s) return
    const at = this._point
    this._splice(at, at, s)
    this.point = at + s.length
  }

  deleteBackward(): void {
    if (this._point <= 0) return
    this._splice(this._point - 1, this._point, "")
  }

  deleteForward(): void {
    if (this._point >= this._text.length) return
    this._splice(this._point, this._point + 1, "")
  }

  deleteRange(start: number, end: number): string {
    const removed = this._splice(start, end, "")
    if (removed) this.point = clamp(Math.min(start, end), 0, this._text.length)
    return removed
  }

  get point(): number { return this._point }
  set point(n: number) { this._point = n; this.goalColumn = null }

  move(delta: number): void {
    this.point = clamp(this.point + delta, 0, this.text.length)
  }

  moveLine(delta: number): void {
    const lines = this.text.split("\n")
    const { line, col } = this.lineCol()
    const goal = this.goalColumn ?? col - 1
    const nextLine = clamp(line - 1 + delta, 0, lines.length - 1)
    let offset = 0
    for (let i = 0; i < nextLine; i++) offset += lines[i]!.length + 1
    this._point = clamp(offset + Math.min(goal, lines[nextLine]!.length), 0, this.text.length)
    this.goalColumn = goal
  }

  moveToLineStart(): void {
    const previousNewline = this.point <= 0 ? -1 : this.text.lastIndexOf("\n", this.point - 1)
    this.point = previousNewline + 1
  }

  moveToLineEnd(): void {
    const nextNewline = this.text.indexOf("\n", this.point)
    this.point = nextNewline === -1 ? this.text.length : nextNewline
  }

  moveToBufferStart(): void {
    this.point = 0
  }

  moveToBufferEnd(): void {
    this.point = this.text.length
  }

  moveWord(delta: number): void {
    const fwd = (this.locals.get("word-forward-regexp") as string | undefined) ?? "\\W*\\w+"
    const bwd = (this.locals.get("word-backward-regexp") as string | undefined) ?? "\\w+"
    if (delta > 0) {
      const match = new RegExp(fwd).exec(this.text.slice(this.point))
      this.point = match ? this.point + match.index + match[0].length : this.text.length
      return
    }

    const before = this.text.slice(0, this.point)
    const matches = [...before.matchAll(new RegExp(bwd, "g"))]
    const previous = matches.at(-1)
    this.point = previous?.index ?? 0
  }

  setMark(): void {
    this.mark = this.point
    this.markActive = true
  }

  deactivateMark(): void {
    if (!isTransientMarkModeEnabled()) return
    this.markActive = false
  }

  clearMark(): void {
    this.mark = null
    this.markActive = false
  }

  exchangePointAndMark(reactivate = true): boolean {
    if (this.mark == null) return false
    const previousMark = this.mark
    this.mark = this.point
    this.point = previousMark
    this.markActive = reactivate
    return true
  }

  selectedText(): string {
    if (this.mark == null || this.mark === this.point) return ""
    const [a, b] = [this.mark, this.point].sort((x, y) => x - y)
    return this.text.slice(a, b)
  }

  selectedOrAll(): string {
    return this.selectedText() || this.text
  }

  async save(ctx: SaveContext = {}): Promise<void> {
    if (!this.path) throw new Error(`Buffer ${this.name} has no file path`)
    await ctx.runHook?.("before-save-hook", this)
    if (!ctx.force && !(await this.verifyVisitedFileModtime())) {
      const ok = await ctx.confirm?.(`${this.name} has changed on disk; save anyway?`)
      if (ok !== true) throw new Error(`File ${this.path} changed on disk since visited`)
    }
    if ((ctx.makeBackupFiles ?? true) && !this.backedUp && await fileExists(this.path)) {
      await copyFile(this.path, this.path + "~")
      this.backedUp = true
    }
    await writeFileText(this.path, this.text)
    this.visitedFileModtime = await fileModtime(this.path)
    this.savedNode = this.undoCur
    this.dirty = false
    await ctx.runHook?.("after-save-hook", this)
  }

  /** Emacs verify-visited-file-modtime: false only when a visited file's disk mtime
   *  has moved past what we recorded. No path / never-read / deleted-on-disk → true. */
  async verifyVisitedFileModtime(): Promise<boolean> {
    if (!this.path || this.visitedFileModtime == null) return true
    const diskMtime = await fileModtime(this.path)
    return diskMtime == null || diskMtime <= this.visitedFileModtime
  }

  /** Re-read from disk. Shared body for revert-buffer, auto-revert, and the
   *  openFile revisit prompt; refreshes visitedFileModtime so a subsequent
   *  save() doesn't spuriously see a clash. Undo history is kept — the revert
   *  itself becomes an undoable step — and the saved-state baseline moves here. */
  async revert(): Promise<void> {
    if (!this.path) throw new Error(`Buffer ${this.name} is not visiting a file`)
    const text = await readFileText(this.path)
    this.setText(text, false)
    this.visitedFileModtime = await fileModtime(this.path)
    this.savedNode = this.undoCur
    this.dirty = false
  }

  undo(): void {
    const node = this.undoCur
    if (!node.parent) return
    for (let i = node.ops.length - 1; i >= 0; i--) {
      const op = node.ops[i]!
      this._splice(op.from, op.from + op.inserted.length, op.removed, { snapshot: false })
    }
    this.point = node.ops[0]!.point
    this.undoCur = node.parent
    this.dirty = this.undoCur !== this.savedNode
  }

  /** Fold the most recent mutation into the previous undo step. Call immediately
   *  after the second mutation. */
  amalgamateUndo(): void {
    const p = this.undoCur.parent
    if (!p?.parent) return
    this.undoCur.ops = [...p.ops, ...this.undoCur.ops]
    this.undoCur.parent = p.parent
    p.parent.children[p.parent.children.indexOf(p)] = this.undoCur
  }

  redo(): void {
    const child = this.undoCur.children.at(-1)
    if (!child) return
    for (const op of child.ops) {
      this._splice(op.from, op.from + op.removed.length, op.inserted, { snapshot: false })
    }
    this.undoCur = child
    this.dirty = this.undoCur !== this.savedNode
  }

  replaceRange(start: number, end: number, replacement: string): void {
    this._splice(start, end, replacement)
    this.point = clamp(Math.min(start, end), 0, this._text.length) + replacement.length
  }

  lineBoundsAt(point = this.point): { start: number; end: number; text: string } {
    const start = point <= 0 ? 0 : this.text.lastIndexOf("\n", point - 1) + 1
    const newline = this.text.indexOf("\n", point)
    const end = newline === -1 ? this.text.length : newline
    return { start, end, text: this.text.slice(start, end) }
  }

  symbolBoundsAt(point = this.point): { start: number; end: number; text: string } {
    const isSymbol = (ch: string) => /[A-Za-z0-9_]/.test(ch)
    let start = clamp(point, 0, this.text.length)
    let end = start
    while (start > 0 && isSymbol(this.text[start - 1]!)) start--
    while (end < this.text.length && isSymbol(this.text[end]!)) end++
    return { start, end, text: this.text.slice(start, end) }
  }

  private adjustMark(from: number, to: number, inserted: number): void {
    if (this.mark == null) return
    if (this.mark > to) this.mark += inserted - (to - from)
    else if (this.mark > from) this.mark = from
    this.mark = clamp(this.mark, 0, this._text.length)
  }

  private assertWritable(markDirty: boolean): void {
    if (markDirty && this.readOnly) throw new Error(`Buffer ${this.name} is read-only`)
  }

  private record(from: number, to: number, removed: string, inserted: string): void {
    const node: UndoNode = { ops: [{ from, to, removed, inserted, point: this._point }], parent: this.undoCur, children: [] }
    this.undoCur.children.push(node)
    this.undoCur = node
  }
}

async function fileModtime(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return undefined
  }
}

export function inferMode(path: string): string {
  if (/\.(js|mjs|cjs|jsx)$/.test(path)) return "javascript"
  if (/\.(ts|mts|cts|tsx)$/.test(path)) return "typescript"
  if (/\.(html?|xhtml)$/.test(path)) return "html"
  if (/\.java$/.test(path)) return "java"
  if (/\.json$/.test(path)) return "json"
  if (/\.(c|h)$/.test(path)) return "c"
  if (/\.ya?ml$/.test(path)) return "yaml"
  if (/README\.md$/i.test(path)) return "gfm"
  if (/\.(?:md|markdown|mkd|mdown|mkdn|mdwn)$/i.test(path)) return "markdown"
  if (/\.py$/.test(path)) return "python"
  if (/\.rs$/.test(path)) return "rust"
  if (/\.go$/.test(path)) return "go"
  if (/\.proto$/.test(path)) return "protobuf"
  if (/\.http$/.test(path)) return "restclient"
  if (/\.tf$/.test(path)) return "terraform"
  if (/\.(hbs|handlebars)$/.test(path)) return "handlebars"
  if (/\.glsl$/.test(path)) return "glsl"
  if (/(^|\/)Jenkinsfile$/.test(path)) return "jenkinsfile"
  if (/\.exs?$/.test(path)) return "elixir"
  if (/\.prisma$/.test(path)) return "prisma"
  return "text"
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
