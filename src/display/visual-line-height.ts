import type { BufferModel } from "../kernel/buffer"
import type { TextSpan } from "../modes/mode"
import { resolveFace } from "../runtime/faces"
import {
  DOM_FRAME_LINE_HEIGHT_RATIO,
  DOM_FRAME_ROW_PX,
  effectiveFontSizePx,
} from "./dom-frame"

const DOM_FRAME_BODY_FONT_PX_FALLBACK = 13
import type { Theme } from "./theme"
import { styleToChunk } from "./themed-text"

function bodyDefaultFontPx(theme: Theme, buffer?: BufferModel): number {
  const defaultStyle = resolveFace("default", theme, buffer)
  return defaultStyle?.height != null ? defaultStyle.height / 10 : DOM_FRAME_BODY_FONT_PX_FALLBACK
}

function lineMaxFontPx(
  lineStart: number,
  lineEnd: number,
  spans: TextSpan[],
  theme: Theme,
  buffer: BufferModel | undefined,
  textScale: number,
  defaultPx: number,
): number {
  let maxPx = effectiveFontSizePx({ text: "" }, textScale, defaultPx) ?? defaultPx * textScale
  for (const span of spans) {
    if (span.end <= lineStart || span.start >= lineEnd) continue
    const style = resolveFace(span.face, theme, buffer)
    const px = effectiveFontSizePx({ text: "", ...styleToChunk(style) }, textScale, defaultPx)
    if (px != null && px > maxPx) maxPx = px
  }
  return maxPx
}

/** GUI visual row cost per logical line (1.0 ≈ one `DOM_FRAME_ROW_PX` row). */
export function computeLineVisualRows(
  text: string,
  spans: TextSpan[],
  theme: Theme,
  buffer?: BufferModel,
  textScale = 1,
): number[] {
  const lines = text.split("\n")
  if (!lines.length) return []
  const defaultPx = bodyDefaultFontPx(theme, buffer)
  const rowPx = DOM_FRAME_ROW_PX * textScale
  const rows: number[] = []
  let offset = 0
  for (const line of lines) {
    const lineStart = offset
    const lineEnd = offset + line.length
    const maxPx = lineMaxFontPx(lineStart, lineEnd, spans, theme, buffer, textScale, defaultPx)
    rows.push((maxPx * DOM_FRAME_LINE_HEIGHT_RATIO) / rowPx)
    offset = lineEnd + 1
  }
  return rows
}

/** @deprecated Use `computeLineVisualRows`. Kept as alias for tests. */
export const computeLineVisualWeights = computeLineVisualRows

export function visualRowsUsed(rows: readonly number[], fromLine: number, toLine: number): number {
  let sum = 0
  for (let i = Math.max(0, fromLine); i <= toLine && i < rows.length; i++) sum += rows[i] ?? 1
  return sum
}

import { setDisplaySystem } from "../kernel/extension-points"

/** Keep `cursorLine` visible within a weighted GUI row budget. */
export function syncViewportStartLine(
  startLine: number,
  cursorLine: number,
  lineBudget: number,
  visualRows?: readonly number[],
): number {
  if (cursorLine < startLine) return cursorLine
  if (!visualRows?.length) {
    if (cursorLine >= startLine + lineBudget) return Math.max(0, cursorLine - lineBudget + 1)
    return startLine
  }
  let start = startLine
  while (start < cursorLine && visualRowsUsed(visualRows, start, cursorLine) > lineBudget) start++
  if (start > cursorLine) start = cursorLine
  return start
}

setDisplaySystem({ syncViewportStartLine })

/** How many logical lines fit in `lineBudget` GUI rows from `startLine`. */
export function visibleLineCountForBudget(
  startLine: number,
  lineBudget: number,
  totalLines: number,
  visualRows?: readonly number[],
): number {
  const remaining = Math.max(0, totalLines - startLine)
  if (!visualRows?.length || remaining === 0) return Math.min(lineBudget, remaining)
  let used = 0
  let count = 0
  for (let i = startLine; i < totalLines; i++) {
    const cost = visualRows[i] ?? 1
    if (count > 0 && used + cost > lineBudget + 1e-6) break
    used += cost
    count++
  }
  return Math.max(1, Math.min(count, remaining))
}
