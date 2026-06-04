import type { FaceStyle } from "./theme"

export type ThemedChunk = {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type ThemedText = {
  chunks: ThemedChunk[]
}

export function plainThemedText(text: string, style?: FaceStyle): ThemedText {
  if (!style?.fg && !style?.bg && !style?.bold && !style?.italic && !style?.underline) {
    return { chunks: [{ text }] }
  }
  return { chunks: [{ text, ...style }] }
}

export function themedTextPlain(model: ThemedText): string {
  return model.chunks.map(c => c.text).join("")
}
