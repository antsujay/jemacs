import type { Editor } from "../kernel/editor"
import { isearchMatchSpan } from "../kernel/isearch"
import { findWindowLeaf, type WindowLeaf, type WindowNode } from "../kernel/window"
import { textWithCursor } from "../ui/text-display"
import { windowClickState } from "./click-to-point"
import { visibleStyledTextFromStart } from "./buffer-view"
import type { DisplayModel, WindowDisplayNode } from "./protocol"
import { bufferHighlightSpans } from "./buffer-highlights"
import { applyTheme } from "./theme"
import { plainThemedText } from "./themed-text"
import { contentAreaLines, type ViewportSize } from "./viewport"

export type BuildDisplayOptions = {
  lastMessage: string
  viewport: ViewportSize
  hostLabel?: string
}

export function buildDisplayModel(editor: Editor, options: BuildDisplayOptions): DisplayModel {
  const { viewport, lastMessage, hostLabel = "Jemacs" } = options
  const buffer = editor.currentBuffer
  const pending = editor.keymaps.pendingSequence()
  const depth = editor.minibuffer && editor.minibufferDepthLevel > 1
    ? ` [${editor.minibufferDepthLevel}]`
    : ""

  const titleText = ` ${hostLabel} — ${buffer.name}${buffer.dirty ? "*" : ""}`
  const title = applyTheme(titleText, [{ start: 0, end: titleText.length, face: "title" }], editor.theme)

  const areaLines = contentAreaLines(viewport.rows)
  const windows = buildWindowTree(editor, editor.windowLayout, areaLines)

  const minibuffer = buildMinibufferChunk(editor, depth)
  const echoText = ` ${lastMessage}${pending && !editor.minibuffer ? `  [${pending}]` : ""}`
  const echo = applyTheme(echoText, [{ start: 0, end: echoText.length, face: "minibuffer" }], editor.theme)

  return {
    title,
    windows,
    minibuffer,
    echo,
    theme: editor.theme,
    viewport,
    hostLabel,
  }
}

function buildMinibufferChunk(editor: Editor, depth: string) {
  if (editor.minibuffer) {
    const prompt = `${depth} ${editor.minibuffer.prompt}`
    const input = textWithCursor(editor.activeBuffer.text, editor.activeBuffer.point)
    const minibufferText = prompt + input
    return applyTheme(minibufferText, [
      { start: 0, end: prompt.length, face: "minibufferPrompt" },
      { start: prompt.length, end: minibufferText.length, face: "minibuffer" },
    ], editor.theme)
  }
  if (editor.isearch) {
    const state = editor.isearch
    const label = state.direction === 1 ? "I-search" : "I-search backward"
    const prompt = ` ${label}: `
    const query = textWithCursor(state.string, state.string.length)
    const isearchText = prompt + query
    return applyTheme(isearchText, [
      { start: 0, end: prompt.length, face: "minibufferPrompt" },
      { start: prompt.length, end: isearchText.length, face: "minibuffer" },
    ], editor.theme)
  }
  return applyTheme(" ", [], editor.theme)
}

function buildWindowTree(editor: Editor, layout: WindowNode, availableLines: number): WindowDisplayNode {
  if (layout.kind === "leaf") {
    return { kind: "leaf", pane: buildLeafPane(editor, layout, availableLines), lineBudget: availableLines }
  }
  const { first, second } = splitLineBudget(availableLines, layout.direction)
  return {
    kind: "split",
    direction: layout.direction,
    first: buildWindowTree(editor, layout.first, first),
    second: buildWindowTree(editor, layout.second, second),
  }
}

function buildLeafPane(editor: Editor, leaf: WindowLeaf, availableLines: number) {
  const selected = leaf.id === editor.selectedWindowId
  const maxLines = Math.max(1, availableLines - 1)
  const buffer = editor.buffers.get(leaf.bufferId)
  if (!buffer) {
    return {
      id: leaf.id,
      bufferId: leaf.bufferId,
      selected,
      dedicated: leaf.dedicated,
      body: plainThemedText(""),
      modeline: applyTheme(" (empty)", [], editor.theme),
      clickState: { startLine: 0, gutterPrefixLen: 0 },
      bodyLineBudget: maxLines,
      syncText: "",
      syncPoint: 0,
      syncSpans: [],
    }
  }

  const point = selected ? buffer.point : leaf.point
  const dirty = buffer.dirty ? "*" : ""
  const { line, col } = pointLineCol(buffer.text, point)
  if (selected) editor.syncSelectedWindowViewport(maxLines)
  const startLine = findWindowLeaf(editor.windowLayout, leaf.id)?.startLine ?? leaf.startLine

  const spans = [...editor.fontLock(buffer)]
  if (selected && editor.isearch) {
    const match = isearchMatchSpan(buffer, editor.isearch)
    if (match) spans.push(match)
  }
  const showLineNumbers = buffer.kind !== "minibuffer" && editor.showLineNumbers(buffer)
  const mark = selected ? buffer.mark : null
  const syncSpans = bufferHighlightSpans(point, mark, spans)
  const body = visibleStyledTextFromStart(buffer.text, point, startLine, {
    mark,
    spans,
    theme: editor.theme,
    maxLines,
    showLineNumbers,
    showCursor: selected,
  })
  const lighters = editor.minorModeLighters(buffer)
  const modelineText = ` ${buffer.mode}${lighters}  ${buffer.name}${dirty}${leaf.dedicated ? " [D]" : ""}  line ${line}, col ${col}${selected && buffer.mark != null ? `  mark=${buffer.mark}` : ""}`
  const modeline = applyTheme(modelineText, [{
    start: 0,
    end: modelineText.length,
    face: selected ? "modeLine" : "modeLineInactive",
  }], editor.theme)

  const clickState = windowClickState(buffer.text, startLine, maxLines, showLineNumbers)

  return {
    id: leaf.id,
    bufferId: leaf.bufferId,
    selected,
    dedicated: leaf.dedicated,
    body,
    modeline,
    clickState,
    bodyLineBudget: maxLines,
    syncText: buffer.text,
    syncPoint: point,
    syncSpans,
  }
}

function splitLineBudget(availableLines: number, direction: "horizontal" | "vertical"): { first: number; second: number } {
  if (direction === "horizontal") {
    return { first: availableLines, second: availableLines }
  }
  const first = Math.max(3, Math.floor(availableLines / 2))
  return { first, second: Math.max(3, availableLines - first) }
}

function pointLineCol(text: string, point: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(0, Math.min(point, text.length)))
  const lines = before.split("\n")
  return { line: lines.length, col: lines.at(-1)!.length + 1 }
}
