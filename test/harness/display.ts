import type { Editor } from "../../src/kernel/editor"
import { buildDisplayModel } from "../../src/display/build-display-model"
import { themedTextPlain } from "../../src/display/themed-text"
import type { WindowDisplayNode, DisplayModel } from "../../src/display/protocol"

const VIEWPORT = { rows: 30, cols: 100 }

export function display(editor: Editor, viewport = VIEWPORT): DisplayModel {
  return buildDisplayModel(editor, { viewport })
}

function leaves(node: WindowDisplayNode): Array<Extract<WindowDisplayNode, { kind: "leaf" }>> {
  return node.kind === "leaf" ? [node] : [...leaves(node.first), ...leaves(node.second)]
}

function selectedLeaf(model: DisplayModel) {
  const all = leaves(model.windows)
  return all.find(l => l.pane.selected) ?? all[0]!
}

/** Body of the selected window as plain text rows (split on newline). */
export function displayRows(editor: Editor, viewport = VIEWPORT): string[] {
  return themedTextPlain(selectedLeaf(display(editor, viewport)).pane.body).split("\n")
}

export function modeline(editor: Editor, viewport = VIEWPORT): string {
  return themedTextPlain(selectedLeaf(display(editor, viewport)).pane.modeline)
}

export function echoArea(editor: Editor, viewport = VIEWPORT): string {
  return themedTextPlain(display(editor, viewport).echo)
}

/** All highlight spans in the selected window's syncSpans (region, isearch, paren). */
export function spans(editor: Editor, viewport = VIEWPORT) {
  return selectedLeaf(display(editor, viewport)).pane.syncSpans ?? []
}
