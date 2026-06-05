import { textWithCursor } from "../ui/text-display"

export type ViewportSize = {
  rows: number
  cols?: number
}

/** Rows used by title, minibuffer, and echo (outside the window stack). */
const FRAME_CHROME_LINES = 3

/** Mode line row inside each window pane. */
const MODE_LINE_LINES = 1

/** Lines available to the window stack (all panes share this vertical budget). */
export function contentAreaLines(rows: number): number {
  return Math.max(MODE_LINE_LINES + 1, rows - FRAME_CHROME_LINES)
}

/** Body text lines for a pane given its share of the window stack height. */
export function windowBodyLines(availableInWindowArea: number): number {
  return Math.max(1, availableInWindowArea - MODE_LINE_LINES)
}

/** Scroll/recenter page size for a single full-height window. */
export function pageScrollLines(rows = defaultTerminalRows()): number {
  return windowBodyLines(contentAreaLines(rows))
}

export function defaultTerminalRows(): number {
  return typeof process !== "undefined" && process.stdout?.rows ? process.stdout.rows : 30
}

export function visibleTextRegionFromStart(
  text: string,
  startLine: number,
  lineBudget: number,
  /** Pass `buffer.lineStarts` when `text === buffer.text` to skip the O(n) scan. */
  lineStarts?: readonly number[],
): { visible: string; visibleStart: number } {
  const ls = lineStarts ?? scanLineStarts(text)
  const start = Math.max(0, Math.min(startLine, Math.max(0, ls.length - lineBudget)))
  const visibleStart = ls[start]!
  const end = start + lineBudget
  const visibleEnd = end < ls.length ? ls[end]! - 1 : text.length
  return { visible: text.slice(visibleStart, visibleEnd), visibleStart }
}

function scanLineStarts(text: string): number[] {
  const ls = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) ls.push(i + 1)
  return ls
}

export function visibleTextRegion(
  text: string,
  point: number,
  lineBudget: number,
): { visible: string; visibleStart: number } {
  const cursorPoint = Math.max(0, Math.min(point, text.length))
  const withCursor = textWithCursor(text, point)
  const lines = withCursor.split("\n")
  const cursorLine = withCursor.slice(0, cursorPoint).split("\n").length - 1
  const start = Math.max(0, Math.min(cursorLine - Math.floor(lineBudget / 2), lines.length - lineBudget))
  const visibleStart = lines.slice(0, start).join("\n").length + (start > 0 ? 1 : 0)
  const visible = lines.slice(start, start + lineBudget).join("\n")
  return { visible, visibleStart }
}

export function visibleText(text: string, point: number, lineBudget: number): string {
  return visibleTextRegion(text, point, lineBudget).visible
}
