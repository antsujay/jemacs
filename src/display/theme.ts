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

export const defaultTheme: Theme = {
  name: "jemacs-dark",
  faces: {
    default: { fg: "#d4d4d4" },
    keyword: { fg: "#569cd6", bold: true },
    string: { fg: "#ce9178" },
    comment: { fg: "#6a9955", italic: true },
    builtin: { fg: "#4ec9b0" },
    function: { fg: "#dcdcaa" },
    type: { fg: "#4ec9b0" },
    number: { fg: "#b5cea8" },
    constant: { fg: "#9cdcfe" },
    directory: { fg: "#4fc1ff", bold: true },
    modeLine: { fg: "#ffffff", bg: "#264f78", bold: true },
    minibuffer: { fg: "#ffffff", bg: "#3a3a3a" },
    error: { fg: "#f44747", bold: true },
  },
}

export function applyTheme(text: string, spans: TextSpan[], theme: Theme): StyledText {
  if (!spans.length) return new StyledText([plainChunk(text)])
  const ordered = spans
    .filter(span => span.end > span.start && span.start < text.length)
    .map(span => ({ ...span, start: Math.max(0, span.start), end: Math.min(text.length, span.end) }))
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const chunks: TextChunk[] = []
  let offset = 0
  for (const span of ordered) {
    if (span.start < offset) continue
    if (span.start > offset) chunks.push(plainChunk(text.slice(offset, span.start)))
    chunks.push(styledChunk(text.slice(span.start, span.end), theme.faces[span.face]))
    offset = span.end
  }
  if (offset < text.length) chunks.push(plainChunk(text.slice(offset)))
  return new StyledText(chunks)
}

function plainChunk(text: string): TextChunk {
  return { __isChunk: true, text }
}

function styledChunk(text: string, style?: FaceStyle): TextChunk {
  if (!style) return plainChunk(text)
  return {
    __isChunk: true,
    text,
    fg: style.fg ? parseColor(style.fg) : undefined,
    bg: style.bg ? parseColor(style.bg) : undefined,
    attributes: createTextAttributes(style),
  }
}
