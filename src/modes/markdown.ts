import type { BufferModel } from "../kernel/buffer"
import type { Editor } from "../kernel/editor"
import { Keymap } from "../kernel/keymap"
import { defface, faceRemapAddRelative } from "../runtime/faces"
import { defineMode } from "./mode"
import { createTreeSitterFontLock } from "./tree-sitter"

const TAB_WIDTH = 4
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+/
const ATX_HEADER_RE = /^(#{1,6})\s/
const BLOCKQUOTE_RE = /^(\s*)>+\s?/
const FENCED_CODE_RE = /^```/
let lastIndentCommand: "markdown-indent-line" | "markdown-cycle" | "markdown-enter-key" | null = null

const MARKDOWN_HEADER_FACES = [
  ["markdown-header-face-1", 2.0],
  ["markdown-header-face-2", 1.7],
  ["markdown-header-face-3", 1.4],
  ["markdown-header-face-4", 1.2],
  ["markdown-header-face-5", 1.1],
  ["markdown-header-face-6", 1.0],
] as const

export function installMarkdownMode(editor: Editor): void {
  installMarkdownCommands(editor)

  for (const [name] of MARKDOWN_HEADER_FACES) defface(name, {}, "Markdown ATX/setext header face.")
  const keymap = new Keymap("markdown-map")
  bindMarkdownModeMap(keymap)

  defineMode({
    name: "markdown",
    parent: "text",
    commentStart: "<!--",
    keymap,
    indentLine: markdownIndentLine,
    fontLock: createTreeSitterFontLock("markdown"),
    onEnter: applyMarkdownFaceRemap,
  })

  const gfmKeymap = new Keymap("gfm-map")
  gfmKeymap.bind("C-c C-s d", "markdown-insert-strike-through")
  defineMode({
    name: "gfm",
    parent: "markdown",
    keymap: gfmKeymap,
    fontLock: createTreeSitterFontLock("gfm"),
    onEnter: applyMarkdownFaceRemap,
  })
}

function applyMarkdownFaceRemap(buffer: BufferModel): void {
  faceRemapAddRelative(buffer, "default", { family: "Helvetica Neue", height: 200 })
  for (const [face, scale] of MARKDOWN_HEADER_FACES) {
    faceRemapAddRelative(buffer, face, { heightScale: scale })
  }
}

function bindMarkdownModeMap(keymap: Keymap): void {
  keymap.bind("return", "markdown-enter-key")
  keymap.bind("enter", "markdown-enter-key")
  keymap.bind("C-m", "markdown-enter-key")
  keymap.bind("tab", "markdown-cycle")
  keymap.bind("C-i", "markdown-cycle")
  keymap.bind("S-tab", "markdown-shifttab")
  keymap.bind("backspace", "markdown-outdent-or-delete")
  keymap.bind("C-c >", "markdown-indent-region")
  keymap.bind("C-c <", "markdown-outdent-region")
  keymap.bind("C-c C-l", "markdown-insert-link")
  keymap.bind("C-c C--", "markdown-promote")
  keymap.bind("C-c C-=", "markdown-demote")
  keymap.bind("C-c C-n", "markdown-outline-next")
  keymap.bind("C-c C-p", "markdown-outline-previous")
  keymap.bind("C-c C-f", "markdown-outline-next-same-level")
  keymap.bind("C-c C-b", "markdown-outline-previous-same-level")
  keymap.bind("C-c C-u", "markdown-outline-up")
  keymap.bind("C-c C-j", "markdown-insert-list-item")
  keymap.bind("M-RET", "markdown-insert-list-item")
  keymap.bind("C-c -", "markdown-insert-hr")
  keymap.bind("C-c C-t 1", "markdown-insert-header-atx-1")
  keymap.bind("C-c C-t 2", "markdown-insert-header-atx-2")
  keymap.bind("C-c C-t 3", "markdown-insert-header-atx-3")
  keymap.bind("C-c C-t 4", "markdown-insert-header-atx-4")
  keymap.bind("C-c C-t 5", "markdown-insert-header-atx-5")
  keymap.bind("C-c C-t 6", "markdown-insert-header-atx-6")
  keymap.bind("C-a", "markdown-beginning-of-line")
  keymap.bind("C-e", "markdown-end-of-line")
  keymap.bind("M-{", "markdown-backward-paragraph")
  keymap.bind("M-}", "markdown-forward-paragraph")
  keymap.bind("esc {", "markdown-backward-paragraph")
  keymap.bind("esc }", "markdown-forward-paragraph")
}

function installMarkdownCommands(editor: Editor): void {
  editor.command("markdown-enter-key", ({ buffer, editor }) => {
    lastIndentCommand = "markdown-enter-key"
    const line = buffer.lineBoundsAt()
    const trimmed = line.text.trim()
    if (LIST_RE.test(trimmed) && trimmed.replace(LIST_RE, "").trim() === "") {
      buffer.replaceRange(line.start, line.end, "")
      buffer.point = line.start
      buffer.insert("\n")
      markdownIndentLine(buffer)
      return
    }
    buffer.insert("\n")
    markdownIndentLine(buffer)
    editor.message("New line")
  }, "Insert a newline and indent like `markdown-mode`.")

  editor.command("markdown-indent-line", ({ buffer }) => {
    lastIndentCommand = "markdown-indent-line"
    markdownIndentLine(buffer)
  }, "Indent the current line using Markdown heuristics.")

  editor.command("markdown-cycle", ({ buffer }) => {
    lastIndentCommand = "markdown-cycle"
    markdownIndentLine(buffer, true)
  }, "Cycle among reasonable indentation columns.")

  editor.command("markdown-shifttab", ({ buffer }) => {
    markdownOutdentLine(buffer)
  }, "Outdent the current line one step.")

  editor.command("markdown-outdent-or-delete", ({ buffer }) => {
    const line = buffer.lineBoundsAt()
    const content = line.text.replace(/^\s*/, "")
    if (content.length === 0 && line.text.length > 0) {
      markdownOutdentLine(buffer)
      return
    }
    if (buffer.point > line.start) buffer.deleteBackward()
  }, "Outdent when only whitespace precedes point, else delete backward.")

  editor.command("markdown-indent-region", ({ buffer }) => {
    const region = regionBounds(buffer)
    indentRegion(buffer, region.start, region.end, TAB_WIDTH)
  }, "Indent the active region.")

  editor.command("markdown-outdent-region", ({ buffer }) => {
    const region = regionBounds(buffer)
    indentRegion(buffer, region.start, region.end, -TAB_WIDTH)
  }, "Outdent the active region.")

  editor.command("markdown-insert-link", ({ buffer, editor }) => {
    wrapOrInsert(buffer, "[", "](url)", "link text")
    editor.message("Inserted link")
  }, "Insert a Markdown inline link.")

  editor.command("markdown-insert-list-item", ({ buffer, editor }) => {
    const line = buffer.lineBoundsAt()
    const match = line.text.match(LIST_RE)
    const indent = match?.[1] ?? ""
    const marker = match?.[2]?.match(/^\d/) ? "1. " : "- "
    buffer.insert(`\n${indent}${marker}`)
    editor.message("Inserted list item")
  }, "Start a new list item on the next line.")

  editor.command("markdown-insert-hr", ({ buffer, editor }) => {
    const line = buffer.lineBoundsAt()
    const hr = `${"-".repeat(5)}\n`
    if (line.text.trim()) buffer.insert(`\n${hr}`)
    else buffer.replaceRange(line.start, line.end, hr)
    editor.message("Inserted horizontal rule")
  }, "Insert a horizontal rule.")

  for (let level = 1; level <= 6; level++) {
    const name = `markdown-insert-header-atx-${level}`
    editor.command(name, ({ buffer, editor }) => {
      insertAtxHeader(buffer, level)
      editor.message(`Inserted ATX header level ${level}`)
    }, `Insert a level-${level} ATX header.`)
  }

  editor.command("markdown-promote", ({ buffer, editor }) => {
    changeHeaderLevel(buffer, -1)
    editor.message("Promoted heading")
  }, "Promote the heading at point.")

  editor.command("markdown-demote", ({ buffer, editor }) => {
    changeHeaderLevel(buffer, 1)
    editor.message("Demoted heading")
  }, "Demote the heading at point.")

  editor.command("markdown-insert-strike-through", ({ buffer, editor }) => {
    wrapOrInsert(buffer, "~~", "~~", "text")
    editor.message("Inserted strike-through")
  }, "Insert GFM strike-through markup.")

  editor.command("markdown-beginning-of-line", ({ buffer }) => {
    const line = buffer.lineBoundsAt()
    const text = line.text
    const contentStart = text.match(/^\s*/)?.[0].length ?? 0
    const marker = text.slice(contentStart).match(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/)?.[0].length ?? 0
    const target = line.start + contentStart + marker
    buffer.point = buffer.point <= target ? line.start : target
  }, "Move to meaningful beginning of line in Markdown context.")

  editor.command("markdown-end-of-line", ({ buffer }) => {
    const line = buffer.lineBoundsAt()
    buffer.point = line.end
  }, "Move to end of line.")

  editor.command("markdown-forward-paragraph", ({ buffer }) => {
    buffer.point = findParagraphBoundary(buffer.text, buffer.point, 1)
  }, "Move forward to the next paragraph boundary.")

  editor.command("markdown-backward-paragraph", ({ buffer }) => {
    buffer.point = findParagraphBoundary(buffer.text, buffer.point, -1)
  }, "Move backward to the previous paragraph boundary.")

  editor.command("markdown-outline-next", ({ buffer }) => {
    buffer.point = findHeading(buffer.text, buffer.point, 1, false)
  }, "Move to the next heading.")

  editor.command("markdown-outline-previous", ({ buffer }) => {
    buffer.point = findHeading(buffer.text, buffer.point, -1, false)
  }, "Move to the previous heading.")

  editor.command("markdown-outline-next-same-level", ({ buffer }) => {
    const level = headingLevelAt(buffer.text, buffer.point)
    buffer.point = findHeading(buffer.text, buffer.point, 1, true, level)
  }, "Move to the next heading at the same level.")

  editor.command("markdown-outline-previous-same-level", ({ buffer }) => {
    const level = headingLevelAt(buffer.text, buffer.point)
    buffer.point = findHeading(buffer.text, buffer.point, -1, true, level)
  }, "Move to the previous heading at the same level.")

  editor.command("markdown-outline-up", ({ buffer }) => {
    const level = headingLevelAt(buffer.text, buffer.point)
    if (level <= 1) return
    buffer.point = findHeading(buffer.text, buffer.point, -1, true, level - 1)
  }, "Move to the parent heading.")
}

export function markdownIndentLine(buffer: BufferModel, cycle = false): void {
  const line = buffer.lineBoundsAt()
  const positions = markdownCalcIndents(buffer.text, line.start)
  const content = line.text.replace(/^\s*/, "")
  const currentIndent = line.text.length - content.length
  const column = buffer.point - line.start

  let desired = positions[0] ?? 0
  if (content.length === 0) {
    const prev = previousLineStart(buffer.text, line.start)
    if (prev != null) {
      const prevLine = buffer.text.slice(prev, lineEnd(buffer.text, prev))
      const listMatch = prevLine.match(LIST_RE)
      if (listMatch) desired = listMatch[0]?.length ?? desired
    }
  }
  if (cycle || lastIndentCommand === "markdown-cycle") {
    const idx = positions.indexOf(currentIndent)
    desired = positions[(idx + 1) % positions.length] ?? desired
  }

  buffer.replaceRange(line.start, line.end, " ".repeat(desired) + content)
  buffer.point = line.start + Math.max(desired, column + (desired - currentIndent))
}

function markdownOutdentLine(buffer: BufferModel): void {
  const line = buffer.lineBoundsAt()
  const positions = markdownCalcIndents(buffer.text, line.start).sort((a, b) => a - b)
  const content = line.text.replace(/^\s*/, "")
  const currentIndent = line.text.length - content.length
  const column = buffer.point - line.start
  let desired = 0
  for (const pos of positions) {
    if (pos < currentIndent) desired = pos
  }
  buffer.replaceRange(line.start, line.end, " ".repeat(desired) + content)
  buffer.point = line.start + Math.max(desired, column + (desired - currentIndent))
}

export function markdownCalcIndents(text: string, lineStart: number): number[] {
  const positions = new Set<number>([0])
  const prev = previousLineStart(text, lineStart)
  const prevIndent = prev == null ? 0 : lineIndent(text, prev)
  positions.add(prevIndent)
  positions.add(prevIndent + TAB_WIDTH)
  if (prevIndent >= TAB_WIDTH) positions.add(prevIndent - TAB_WIDTH)

  if (prev != null) {
    const prevLine = text.slice(prev, lineEnd(text, prev))
    const listMatch = prevLine.match(LIST_RE)
    if (listMatch) {
      const markerEnd = prev + (listMatch[0]?.length ?? 0)
      positions.add(markerEnd - prev)
    }
  }

  const line = text.slice(lineStart, lineEnd(text, lineStart))
  if (BLOCKQUOTE_RE.test(line)) {
    const match = line.match(BLOCKQUOTE_RE)
    if (match) positions.add((match[1]?.length ?? 0) + 2)
  }
  if (FENCED_CODE_RE.test(line.trim())) positions.add(prevIndent + TAB_WIDTH)

  let cursor = lineStart
  while (cursor > 0) {
    const start = previousLineStart(text, cursor)
    if (start == null) break
    const body = text.slice(start, lineEnd(text, start))
    const list = body.match(LIST_RE)
    if (list) positions.add(lineIndent(text, start))
    if (ATX_HEADER_RE.test(body.trim())) break
    cursor = start
  }

  return [...positions].sort((a, b) => a - b)
}

function wrapOrInsert(buffer: BufferModel, open: string, close: string, placeholder: string): void {
  const region = activeRegion(buffer)
  if (region) {
    const text = buffer.text.slice(region.start, region.end)
    buffer.replaceRange(region.start, region.end, `${open}${text}${close}`)
    buffer.point = region.end + open.length + close.length
    buffer.clearMark()
    return
  }
  buffer.insert(`${open}${placeholder}${close}`)
  buffer.point -= close.length + placeholder.length
}

function insertAtxHeader(buffer: BufferModel, level: number): void {
  const hashes = "#".repeat(level) + " "
  const region = activeRegion(buffer)
  if (region) {
    const text = buffer.text.slice(region.start, region.end).replace(/^#+\s*/, "")
    buffer.replaceRange(region.start, region.end, `${hashes}${text}`)
    return
  }
  const line = buffer.lineBoundsAt()
  const trimmed = line.text.trimStart()
  if (trimmed) buffer.replaceRange(line.start, line.end, `${hashes}${trimmed}`)
  else buffer.insert(`${hashes}Heading ${level}`)
}

function changeHeaderLevel(buffer: BufferModel, delta: number): void {
  const line = buffer.lineBoundsAt()
  const match = line.text.match(/^(\s*)(#{1,6})(\s*)(.*)$/)
  if (!match) return
  const level = Math.min(6, Math.max(1, match[2]!.length + delta))
  const replacement = `${match[1]}${"#".repeat(level)}${match[3]}${match[4]}`
  buffer.replaceRange(line.start, line.end, replacement)
}

function indentRegion(buffer: BufferModel, start: number, end: number, delta: number): void {
  const lines = buffer.text.split("\n")
  let offset = 0
  const startLine = buffer.text.slice(0, start).split("\n").length - 1
  const endLine = buffer.text.slice(0, end).split("\n").length - 1
  for (let i = 0; i < lines.length; i++) {
    const lineStart = offset
    const lineEndPos = offset + lines[i]!.length
    if (i >= startLine && i <= endLine) {
      if (delta > 0) lines[i] = " ".repeat(delta) + lines[i]
      else lines[i] = lines[i]!.replace(new RegExp(`^ {0,${-delta}}`), "")
    }
    offset = lineEndPos + 1
  }
  buffer.replaceRange(0, buffer.text.length, lines.join("\n"))
}

function regionBounds(buffer: BufferModel): { start: number; end: number } {
  if (buffer.mark != null && buffer.mark !== buffer.point) {
    return { start: Math.min(buffer.mark, buffer.point), end: Math.max(buffer.mark, buffer.point) }
  }
  const line = buffer.lineBoundsAt()
  return { start: line.start, end: line.end < buffer.text.length ? line.end + 1 : line.end }
}

function activeRegion(buffer: BufferModel): { start: number; end: number } | null {
  if (buffer.mark == null || buffer.mark === buffer.point) return null
  return { start: Math.min(buffer.mark, buffer.point), end: Math.max(buffer.mark, buffer.point) }
}

function findParagraphBoundary(text: string, point: number, direction: 1 | -1): number {
  let offset = point
  const atBlank = isBlankLine(text, offset)
  if (direction === 1) {
    if (!atBlank) offset = nextLineStart(text, offset)
    while (offset < text.length && !isBlankLine(text, offset)) offset = nextLineStart(text, offset)
    while (offset < text.length && isBlankLine(text, offset)) offset = nextLineStart(text, offset)
    return Math.min(offset, text.length)
  }
  if (!atBlank) offset = previousLineStart(text, offset) ?? 0
  while (offset > 0 && !isBlankLine(text, offset)) offset = previousLineStart(text, offset) ?? 0
  while (offset > 0 && isBlankLine(text, offset)) offset = previousLineStart(text, offset) ?? 0
  return offset
}

function findHeading(text: string, point: number, direction: 1 | -1, sameLevel: boolean, level?: number): number {
  const positions: Array<{ index: number; level: number }> = []
  for (const match of text.matchAll(/^(#{1,6})\s+/gm)) {
    if (match.index == null) continue
    positions.push({ index: match.index, level: match[1]!.length })
  }
  if (direction === 1) {
    for (const pos of positions) {
      if (pos.index <= point) continue
      if (sameLevel && level != null && pos.level !== level) continue
      return pos.index
    }
    return text.length
  }
  let target = 0
  for (const pos of positions) {
    if (pos.index >= point) break
    if (sameLevel && level != null && pos.level !== level) continue
    target = pos.index
  }
  return target
}

function headingLevelAt(text: string, point: number): number {
  const lineStart = point <= 0 ? 0 : text.lastIndexOf("\n", point - 1) + 1
  const line = text.slice(lineStart, lineEnd(text, lineStart))
  const match = line.match(/^(\s*)(#{1,6})\s/)
  return match?.[2]?.length ?? 1
}

function isBlankLine(text: string, offset: number): boolean {
  const start = offset <= 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1
  const end = lineEnd(text, start)
  return text.slice(start, end).trim() === ""
}

function previousLineStart(text: string, lineStart: number): number | null {
  if (lineStart <= 0) return null
  return text.lastIndexOf("\n", lineStart - 2) + 1
}

function nextLineStart(text: string, offset: number): number {
  const end = lineEnd(text, offset)
  return end >= text.length ? text.length : end + 1
}

function lineEnd(text: string, start: number): number {
  const end = text.indexOf("\n", start)
  return end === -1 ? text.length : end
}

function lineIndent(text: string, lineStart: number): number {
  const line = text.slice(lineStart, lineEnd(text, lineStart))
  return line.match(/^\s*/)?.[0].length ?? 0
}
