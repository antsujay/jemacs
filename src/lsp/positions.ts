import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import type { BufferModel } from "../kernel/buffer"

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }

/** file:// URI (lsp--path-to-uri). */
export function pathToUri(path: string): string {
  return pathToFileURL(resolve(path)).href
}

export function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) return decodeURIComponent(new URL(uri).pathname)
  return uri
}

/** 0-based line, UTF-16 code unit character (lsp--cur-position). Prefer passing the
 *  BufferModel — O(log L) via the incremental lineStarts index; string is a fallback. */
export function pointToPosition(src: BufferModel | string, point: number): LspPosition {
  if (typeof src !== "string") {
    const clamped = Math.max(0, Math.min(point, src.text.length))
    const line = src.lineAt(clamped)
    return { line, character: clamped - src.lineStarts[line]! }
  }
  const clamped = Math.max(0, Math.min(point, src.length))
  let line = 0, lineStart = 0
  for (let i = 0; i < clamped; i++) if (src.charCodeAt(i) === 10) { line++; lineStart = i + 1 }
  return { line, character: clamped - lineStart }
}

export function positionToPoint(src: BufferModel | string, position: LspPosition): number {
  if (typeof src !== "string") {
    const [start, end] = src.lineBounds(position.line)
    return start + Math.max(0, Math.min(position.character, end - start))
  }
  let line = 0, lineStart = 0
  for (let i = 0; i < src.length && line < position.line; i++) if (src.charCodeAt(i) === 10) { line++; lineStart = i + 1 }
  const nl = src.indexOf("\n", lineStart)
  const lineLen = (nl === -1 ? src.length : nl) - lineStart
  return lineStart + Math.max(0, Math.min(position.character, lineLen))
}

export function bufferUri(buffer: BufferModel): string | null {
  if (!buffer.path) return null
  return pathToUri(buffer.path)
}

export function bufferLanguageId(buffer: BufferModel): string {
  const mode = buffer.mode
  if (mode === "python") return "python"
  if (mode === "javascript" || mode === "typescript") return mode
  if (mode === "go") return "go"
  if (mode === "rust") return "rust"
  if (mode === "yaml") return "yaml"
  if (mode === "json") return "json"
  return mode
}
