import type { FaceStyle } from "./theme"
import { faceStyleHasVisual } from "./theme-types"

export type ThemedChunk = {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  family?: string
  height?: number
  heightScale?: number
}

export type ThemedText = {
  chunks: ThemedChunk[]
}

export function chunkHasStyle(chunk: ThemedChunk): boolean {
  return faceStyleHasVisual(chunk)
}

export function plainThemedText(text: string, style?: FaceStyle): ThemedText {
  if (!faceStyleHasVisual(style)) return { chunks: [{ text }] }
  return { chunks: [{ text, ...styleToChunk(style) }] }
}

export function styleToChunk(style?: FaceStyle): Omit<ThemedChunk, "text"> {
  if (!style) return {}
  return {
    fg: style.fg,
    bg: style.bg,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    family: style.family,
    height: style.height,
    heightScale: style.heightScale,
  }
}

export function themedTextPlain(model: ThemedText): string {
  return model.chunks.map(c => c.text).join("")
}
