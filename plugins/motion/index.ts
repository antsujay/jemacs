import type { Editor } from "../../src/kernel/editor"
import { createPluginContext, type PluginContext } from "../../src/runtime/plugin-context"
import type { BufferModel } from "../../src/kernel/buffer"

export function install(editor: Editor, ctx: PluginContext = createPluginContext(editor)): void {
  editor.command("back-to-indentation", ({ buffer }) => {
    backToIndentation(buffer)
  }, "Move point to the first non-whitespace character on this line.")

  editor.command("forward-paragraph", ({ buffer, prefixArgument }) => {
    moveParagraph(buffer, prefixArgument ?? 1)
  }, "Move forward to end of paragraph.")

  editor.command("backward-paragraph", ({ buffer, prefixArgument }) => {
    moveParagraph(buffer, -(prefixArgument ?? 1))
  }, "Move backward to start of paragraph.")

  editor.command("mark-paragraph", ({ buffer, prefixArgument }) => {
    markParagraph(buffer, prefixArgument ?? 1)
  }, "Put point at beginning of this paragraph, mark at end.")

  editor.command("transpose-words", ({ buffer, editor }) => {
    if (!transposeWords(buffer)) editor.message("Don't have two things to transpose")
  }, "Interchange words around point, leaving point at end of them.")

  editor.command("transpose-lines", ({ buffer, editor, prefixArgument }) => {
    const result = transposeLines(buffer, prefixArgument ?? 1)
    if (result === "no-mark") editor.message("No mark set in this buffer")
    else if (result === "no-two") editor.message("Don't have two things to transpose")
  }, "Exchange current line and previous line, leaving point after both.")

  editor.key("M-m", "back-to-indentation")
  editor.key("M-}", "forward-paragraph")
  editor.key("M-{", "backward-paragraph")
  editor.key("M-h", "mark-paragraph")
  editor.key("M-t", "transpose-words")
  editor.key("C-x C-t", "transpose-lines")
}

function backToIndentation(buffer: BufferModel): void {
  const { start, end, text } = buffer.lineBoundsAt()
  const match = /^[ \t]*/.exec(text)
  buffer.point = Math.min(start + (match ? match[0].length : 0), end)
}

type LineInfo = { offsets: number[]; lines: string[] }

function lineInfo(text: string): LineInfo {
  const lines = text.split("\n")
  const offsets: number[] = new Array(lines.length)
  let off = 0
  for (let i = 0; i < lines.length; i++) {
    offsets[i] = off
    off += lines[i]!.length + 1
  }
  return { offsets, lines }
}

function lineIndexAt(info: LineInfo, point: number): number {
  let lo = 0
  let hi = info.offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (info.offsets[mid]! <= point) lo = mid
    else hi = mid - 1
  }
  return lo
}

const isBlank = (s: string): boolean => /^[ \t\f]*$/.test(s)

function paragraphBoundaries(info: LineInfo): number[] {
  const bounds: number[] = []
  for (let i = 1; i < info.lines.length; i++) {
    if (isBlank(info.lines[i]!) && !isBlank(info.lines[i - 1]!)) bounds.push(info.offsets[i]!)
  }
  return bounds
}

function moveParagraph(buffer: BufferModel, n: number): void {
  buffer.point = paragraphPosition(buffer.text, buffer.point, n)
}

function paragraphPosition(text: string, from: number, n: number): number {
  if (n === 0) return from
  const info = lineInfo(text)
  const bounds = paragraphBoundaries(info)
  let point = from
  if (n > 0) {
    for (let k = 0; k < n; k++) {
      const next = bounds.find(b => b > point)
      point = next ?? text.length
      if (point === text.length) break
    }
  } else {
    for (let k = 0; k < -n; k++) {
      let prev: number | undefined
      for (let i = bounds.length - 1; i >= 0; i--) {
        if (bounds[i]! < point) { prev = bounds[i]!; break }
      }
      point = prev ?? 0
      if (point === 0) break
    }
  }
  return point
}

function markParagraph(buffer: BufferModel, n: number): void {
  const count = n || 1
  if (count > 0) {
    const start = paragraphPosition(buffer.text, buffer.point, -1)
    buffer.point = start
    buffer.mark = paragraphPosition(buffer.text, start, count)
  } else {
    const end = paragraphPosition(buffer.text, buffer.point, 1)
    buffer.point = end
    buffer.mark = paragraphPosition(buffer.text, end, count)
  }
  buffer.markActive = true
}

function forwardWordEnd(text: string, p: number): number {
  const m = /[^A-Za-z0-9_]*[A-Za-z0-9_]+/.exec(text.slice(p))
  return m ? p + m[0].length : text.length
}

function backwardWordStart(text: string, p: number): number {
  let last: RegExpExecArray | null = null
  const re = /[A-Za-z0-9_]+/g
  const head = text.slice(0, p)
  for (let m = re.exec(head); m; m = re.exec(head)) last = m
  return last ? last.index : 0
}

function wordAround(text: string, p: number, dir: 1 | -1): [number, number] {
  if (dir < 0) {
    const a = backwardWordStart(text, p)
    const b = forwardWordEnd(text, a)
    return [a, b]
  }
  const b = forwardWordEnd(text, p)
  const a = backwardWordStart(text, b)
  return [a, b]
}

function transposeWords(buffer: BufferModel): boolean {
  const text = buffer.text
  const [s1, e1] = wordAround(text, buffer.point, -1)
  const [s2, e2] = wordAround(text, e1, 1)
  return transposeRanges(buffer, s1, e1, s2, e2)
}

type TransposeLinesResult = "ok" | "no-mark" | "no-two"

type LineRecord = { start: number; end: number; text: string }

function transposeLines(buffer: BufferModel, arg: number): TransposeLinesResult {
  if (arg === 0) return transposeLinesAtPointAndMark(buffer)
  return transposeLinesByArg(buffer, arg)
}

function transposeLinesByArg(buffer: BufferModel, arg: number): TransposeLinesResult {
  const records = lineRecords(ensureTrailingNewline(buffer.text))
  const current = lineRecordIndexAt(records, buffer.point)
  const moveIndex = current - 1
  if (moveIndex < 0) return "no-two"
  const insertIndex = moveIndex + arg
  if (insertIndex < 0) return "no-two"
  const rebuilt = moveLineRecord(records, moveIndex, insertIndex)
  if (rebuilt == null) return "no-two"
  buffer.setText(rebuilt.text, true)
  buffer.point = rebuilt.point
  return "ok"
}

function transposeLinesAtPointAndMark(buffer: BufferModel): TransposeLinesResult {
  if (buffer.mark == null) return "no-mark"
  const records = lineRecords(ensureTrailingNewline(buffer.text))
  const pointIndex = lineRecordIndexAt(records, buffer.point)
  const markIndex = lineRecordIndexAt(records, buffer.mark)
  if (pointIndex === markIndex) return "no-two"
  const swapped = records.map(record => record.text)
  ;[swapped[pointIndex], swapped[markIndex]] = [swapped[markIndex]!, swapped[pointIndex]!]
  const point = lineStartFromTexts(swapped, markIndex)
  const mark = lineStartFromTexts(swapped, pointIndex)
  buffer.setText(swapped.join(""), true)
  buffer.point = point
  buffer.mark = mark
  return "ok"
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`
}

function lineRecords(text: string): LineRecord[] {
  const records: LineRecord[] = []
  let start = 0
  while (start < text.length) {
    const newline = text.indexOf("\n", start)
    const end = newline === -1 ? text.length : newline + 1
    records.push({ start, end, text: text.slice(start, end) })
    start = end
  }
  return records
}

function lineRecordIndexAt(records: LineRecord[], point: number): number {
  if (records.length === 0) return 0
  const clamped = clamp(point, 0, records.at(-1)!.end)
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (clamped < record.end || i === records.length - 1) return i
  }
  return records.length - 1
}

function moveLineRecord(records: LineRecord[], moveIndex: number, insertIndex: number): { text: string; point: number } | null {
  const texts = records.map(record => record.text)
  const [moving] = texts.splice(moveIndex, 1)
  if (moving == null) return null
  while (insertIndex > texts.length) texts.push("\n")
  texts.splice(insertIndex, 0, moving)
  return { text: texts.join(""), point: lineStartFromTexts(texts, insertIndex) + moving.length }
}

function lineStartFromTexts(texts: string[], index: number): number {
  let start = 0
  for (let i = 0; i < index; i++) start += texts[i]!.length
  return start
}

function transposeRanges(buffer: BufferModel, s1: number, e1: number, s2: number, e2: number): boolean {
  let a1 = Math.min(s1, e1), b1 = Math.max(s1, e1)
  let a2 = Math.min(s2, e2), b2 = Math.max(s2, e2)
  if (a1 > a2) { [a1, b1, a2, b2] = [a2, b2, a1, b1] }
  if (b1 > a2 || (a1 === a2 && b1 === b2)) return false
  const text = buffer.text
  const first = text.slice(a1, b1)
  const second = text.slice(a2, b2)
  const rebuilt = text.slice(0, a1) + second + text.slice(b1, a2) + first + text.slice(b2)
  buffer.setText(rebuilt, true)
  buffer.point = b2
  return true
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
