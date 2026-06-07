import type { BufferModel } from "../kernel/buffer"
import { getCustom } from "../runtime/custom"
import { modeFeature } from "../modes/mode"
import { gutterPrefixLen } from "./click-to-point"

const MARKDOWN_FILL_COLUMN = "markdown-fill-column"
const MARKDOWN_VISUAL_FILL = "markdown-visual-fill-column-mode"

/** Buffer text projected through the mode display filter (if any). */
export function displayTextForBuffer(buffer: BufferModel): string {
  return modeFeature(buffer.mode, "displayFilter")?.(buffer)?.text ?? buffer.text
}

export type PaneWrapLayout = {
  wrapCols?: number
  gutterPrefixLen: number
}

/** Wrap width and gutter for a pane — shared by display build and scroll math. */
export function paneWrapLayout(
  buffer: BufferModel,
  cols: number | undefined,
  showLineNumbers: boolean,
  startLine: number,
  lineBudget: number,
): PaneWrapLayout {
  const lineCount = displayTextForBuffer(buffer).split("\n").length
  const visibleLineCount = Math.min(lineBudget, Math.max(1, lineCount - startLine))
  const gutter = showLineNumbers ? gutterPrefixLen(startLine + 1, visibleLineCount) : 0
  if (cols == null) return { gutterPrefixLen: gutter }
  if (buffer.locals.get(MARKDOWN_VISUAL_FILL) !== true) {
    return { wrapCols: cols, gutterPrefixLen: gutter }
  }
  const fillColumn = buffer.locals.get(MARKDOWN_FILL_COLUMN) as number | undefined
    ?? getCustom<number>("markdown-fill-column")
    ?? 100
  const contentWidth = Math.max(1, cols - gutter)
  const columnWidth = Math.min(Math.max(1, Math.floor(fillColumn)), contentWidth)
  return { wrapCols: gutter + columnWidth, gutterPrefixLen: gutter }
}

/** Physical display rows after hard-wrapping a logical line. */
export function wrapRowsForContent(lineLen: number, wrapCols: number, gutterPrefixLen: number): number {
  if (wrapCols <= gutterPrefixLen + 1) return 1
  const contentCols = wrapCols - gutterPrefixLen
  if (lineLen <= contentCols) return 1
  return 1 + Math.ceil((lineLen - contentCols) / contentCols)
}
