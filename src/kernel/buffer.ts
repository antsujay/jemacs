import { dirname, basename } from "node:path"

export type BufferKind = "file" | "scratch" | "messages" | "inspector" | "minibuffer"

export class BufferModel {
  readonly id: string
  name: string
  path?: string
  kind: BufferKind
  text: string
  point = 0
  mark: number | null = null
  dirty = false
  mode = "text"
  private undoStack: string[] = []
  private redoStack: string[] = []

  constructor(args: { id?: string; name: string; text?: string; path?: string; kind?: BufferKind; mode?: string }) {
    this.id = args.id ?? crypto.randomUUID()
    this.name = args.name
    this.text = args.text ?? ""
    this.path = args.path
    this.kind = args.kind ?? (args.path ? "file" : "scratch")
    this.mode = args.mode ?? inferMode(args.path ?? args.name)
  }

  static async fromFile(path: string): Promise<BufferModel> {
    const file = Bun.file(path)
    const text = await file.exists() ? await file.text() : ""
    return new BufferModel({ name: basename(path), path, text, kind: "file", mode: inferMode(path) })
  }

  directory(): string | undefined {
    return this.path ? dirname(this.path) : undefined
  }

  lineCol(): { line: number; col: number } {
    const before = this.text.slice(0, this.point)
    const lines = before.split("\n")
    return { line: lines.length, col: lines.at(-1)!.length + 1 }
  }

  setText(text: string, markDirty = true): void {
    this.snapshot()
    this.text = text
    this.point = Math.min(this.point, this.text.length)
    this.dirty ||= markDirty
  }

  insert(s: string): void {
    if (!s) return
    this.snapshot()
    this.text = this.text.slice(0, this.point) + s + this.text.slice(this.point)
    this.point += s.length
    this.dirty = true
  }

  deleteBackward(): void {
    if (this.point <= 0) return
    this.snapshot()
    this.text = this.text.slice(0, this.point - 1) + this.text.slice(this.point)
    this.point--
    this.dirty = true
  }

  deleteForward(): void {
    if (this.point >= this.text.length) return
    this.snapshot()
    this.text = this.text.slice(0, this.point) + this.text.slice(this.point + 1)
    this.dirty = true
  }

  move(delta: number): void {
    this.point = clamp(this.point + delta, 0, this.text.length)
  }

  moveLine(delta: number): void {
    const lines = this.text.split("\n")
    const { line, col } = this.lineCol()
    const nextLine = clamp(line - 1 + delta, 0, lines.length - 1)
    let offset = 0
    for (let i = 0; i < nextLine; i++) offset += lines[i]!.length + 1
    this.point = clamp(offset + Math.min(col - 1, lines[nextLine]!.length), 0, this.text.length)
  }

  setMark(): void {
    this.mark = this.point
  }

  clearMark(): void {
    this.mark = null
  }

  selectedText(): string {
    if (this.mark == null || this.mark === this.point) return ""
    const [a, b] = [this.mark, this.point].sort((x, y) => x - y)
    return this.text.slice(a, b)
  }

  selectedOrAll(): string {
    return this.selectedText() || this.text
  }

  async save(): Promise<void> {
    if (!this.path) throw new Error(`Buffer ${this.name} has no file path`)
    await Bun.write(this.path, this.text)
    this.dirty = false
  }

  undo(): void {
    const previous = this.undoStack.pop()
    if (previous == null) return
    this.redoStack.push(this.text)
    this.text = previous
    this.point = Math.min(this.point, this.text.length)
    this.dirty = true
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (next == null) return
    this.undoStack.push(this.text)
    this.text = next
    this.point = Math.min(this.point, this.text.length)
    this.dirty = true
  }

  private snapshot(): void {
    this.undoStack.push(this.text)
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.redoStack = []
  }
}

export function inferMode(path: string): string {
  if (/\.(js|mjs|cjs|jsx)$/.test(path)) return "javascript"
  if (/\.(ts|mts|cts|tsx)$/.test(path)) return "typescript"
  if (/\.json$/.test(path)) return "json"
  if (/\.md$/.test(path)) return "markdown"
  return "text"
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
