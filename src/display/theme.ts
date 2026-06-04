import type { FaceName, TextSpan } from "../modes/mode"
import { createTextAttributes, parseColor, StyledText, type TextChunk } from "@opentui/core"

export type FaceStyle = {
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type Theme = {
  name: string
  faces: Partial<Record<FaceName, FaceStyle>>
}

/** Build a named theme from face overrides (Emacs custom-theme style). */
export function defineTheme(name: string, faces: Partial<Record<FaceName, FaceStyle>>): Theme {
  return { name, faces }
}

export function applyTheme(text: string, spans: TextSpan[], theme: Theme): StyledText {
  const defaultStyle = theme.faces.default
  if (!spans.length) return new StyledText([styledChunk(text, defaultStyle)])

  const ordered = spans
    .filter(span => span.end > span.start && span.start < text.length)
    .map(span => ({ ...span, start: Math.max(0, span.start), end: Math.min(text.length, span.end) }))
  const boundaries = [...new Set([0, text.length, ...ordered.flatMap(span => [span.start, span.end])])]
    .sort((a, b) => a - b)
  const chunks: TextChunk[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!
    const end = boundaries[i + 1]!
    if (start === end) continue
    const style = ordered.reduce<FaceStyle | undefined>((merged, span) => {
      if (span.start > start || span.end < end) return merged
      return mergeStyle(merged, theme.faces[span.face])
    }, defaultStyle)
    chunks.push(styledChunk(text.slice(start, end), style))
  }
  return new StyledText(chunks)
}

function mergeStyle(base: FaceStyle | undefined, overlay: FaceStyle | undefined): FaceStyle | undefined {
  if (!overlay) return base
  if (!base) return overlay
  return { ...base, ...overlay }
}

function styledChunk(text: string, style?: FaceStyle): TextChunk {
  if (!style?.fg && !style?.bg && !style?.bold && !style?.italic && !style?.underline) {
    return { __isChunk: true, text }
  }
  return {
    __isChunk: true,
    text,
    fg: style.fg ? parseColor(style.fg) : undefined,
    bg: style.bg ? parseColor(style.bg) : undefined,
    attributes: createTextAttributes(style),
  }
}
