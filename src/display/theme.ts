import type { FaceName, TextSpan } from "../modes/mode"
import type { FaceStyle, Theme } from "./theme-types"
import { plainThemedText, type ThemedChunk, type ThemedText } from "./themed-text"

export type { FaceStyle, Theme } from "./theme-types"
export { defineTheme } from "./theme-types"

export function themeFaceBackground(theme: Theme, face: FaceName = "default"): string | undefined {
  return theme.faces[face]?.bg ?? theme.faces.default?.bg
}

export function applyTheme(text: string, spans: TextSpan[], theme: Theme): ThemedText {
  const defaultStyle = theme.faces.default
  if (!spans.length) return plainThemedText(text, defaultStyle)

  const ordered = spans
    .filter(span => span.end > span.start && span.start < text.length)
    .map(span => ({ ...span, start: Math.max(0, span.start), end: Math.min(text.length, span.end) }))
  const boundaries = [...new Set([0, text.length, ...ordered.flatMap(span => [span.start, span.end])])]
    .sort((a, b) => a - b)
  const chunks: ThemedChunk[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!
    const end = boundaries[i + 1]!
    if (start === end) continue
    const style = ordered.reduce<FaceStyle | undefined>((merged, span) => {
      if (span.start > start || span.end < end) return merged
      return mergeStyle(merged, theme.faces[span.face])
    }, defaultStyle)
    chunks.push(themedChunk(text.slice(start, end), style))
  }
  return { chunks }
}

function mergeStyle(base: FaceStyle | undefined, overlay: FaceStyle | undefined): FaceStyle | undefined {
  if (!overlay) return base
  if (!base) return overlay
  return { ...base, ...overlay }
}

function themedChunk(text: string, style?: FaceStyle): ThemedChunk {
  if (!style?.fg && !style?.bg && !style?.bold && !style?.italic && !style?.underline) {
    return { text }
  }
  return {
    text,
    fg: style.fg,
    bg: style.bg,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
  }
}
