import type { TextSpan } from "../modes/mode"

/** Buffer-absolute highlight spans (font-lock, isearch, active region). */
export function bufferHighlightSpans(
  point: number,
  mark: number | null,
  spans: TextSpan[],
): TextSpan[] {
  if (mark == null || mark === point) return spans
  return [...spans, { start: Math.min(mark, point), end: Math.max(mark, point), face: "region" }]
}
