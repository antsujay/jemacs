import type { FaceName, TextSpan } from "../modes/mode"

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

export function applyTheme(text: string, spans: TextSpan[], theme: Theme): string {
  if (!spans.length) return text
  const ordered = spans
    .filter(span => span.end > span.start && span.start < text.length)
    .map(span => ({ ...span, start: Math.max(0, span.start), end: Math.min(text.length, span.end) }))
    .sort((a, b) => a.start - b.start || b.end - a.end)

  let out = ""
  let offset = 0
  for (const span of ordered) {
    if (span.start < offset) continue
    out += text.slice(offset, span.start)
    const open = ansiOpen(theme.faces[span.face])
    out += open + text.slice(span.start, span.end) + (open ? "\x1b[0m" : "")
    offset = span.end
  }
  return out + text.slice(offset)
}

function ansiOpen(style?: FaceStyle): string {
  if (!style) return ""
  const codes: string[] = []
  if (style.bold) codes.push("1")
  if (style.italic) codes.push("3")
  if (style.underline) codes.push("4")
  if (style.fg) codes.push(hexCode(style.fg, 38))
  if (style.bg) codes.push(hexCode(style.bg, 48))
  return codes.length ? `\x1b[${codes.join(";")}m` : ""
}

function hexCode(hex: string, prefix: 38 | 48): string {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!match) return ""
  const [, r, g, b] = match
  return `${prefix};2;${Number.parseInt(r!, 16)};${Number.parseInt(g!, 16)};${Number.parseInt(b!, 16)}`
}
