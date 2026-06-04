import type { DisplayModel, WindowDisplayNode } from "./protocol"
import type { ThemedText } from "./themed-text"

export type SerializedThemedText = { chunks: Array<{ text: string; fg?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean }> }
export type SerializedDisplayModel = {
  title: SerializedThemedText
  windows: SerializedWindowNode
  minibuffer: SerializedThemedText
  echo: SerializedThemedText
  theme: DisplayModel["theme"]
  viewport: DisplayModel["viewport"]
  hostLabel: string
}

export type SerializedWindowNode =
  | { kind: "leaf"; pane: SerializedPane }
  | { kind: "split"; direction: "horizontal" | "vertical"; first: SerializedWindowNode; second: SerializedWindowNode }

export type SerializedPane = {
  id: string
  bufferId: string
  selected: boolean
  dedicated: boolean
  body: SerializedThemedText
  modeline: SerializedThemedText
  clickState: { startLine: number; gutterPrefixLen: number }
  bodyLineBudget: number
  syncText: string
  syncPoint: number
}

export function serializeThemedText(text: ThemedText): SerializedThemedText {
  return { chunks: text.chunks.map(c => ({ ...c })) }
}

export function serializeDisplayModel(model: DisplayModel): SerializedDisplayModel {
  return {
    title: serializeThemedText(model.title),
    windows: serializeWindowNode(model.windows),
    minibuffer: serializeThemedText(model.minibuffer),
    echo: serializeThemedText(model.echo),
    theme: model.theme,
    viewport: model.viewport,
    hostLabel: model.hostLabel,
  }
}

function serializeWindowNode(node: WindowDisplayNode): SerializedWindowNode {
  if (node.kind === "leaf") {
    return {
      kind: "leaf",
      pane: {
        id: node.pane.id,
        bufferId: node.pane.bufferId,
        selected: node.pane.selected,
        dedicated: node.pane.dedicated,
        body: serializeThemedText(node.pane.body),
        modeline: serializeThemedText(node.pane.modeline),
        clickState: node.pane.clickState,
        bodyLineBudget: node.pane.bodyLineBudget,
        syncText: node.pane.syncText,
        syncPoint: node.pane.syncPoint,
      },
    }
  }
  return {
    kind: "split",
    direction: node.direction,
    first: serializeWindowNode(node.first),
    second: serializeWindowNode(node.second),
  }
}
