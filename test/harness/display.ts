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

/** Body of the selected window as plain text rows (split on newline). */
export function displayRows(editor: Editor, viewport = VIEWPORT): string[] {
  const model = display(editor, viewport)
  const leaf = leaves(model.windows)[editor.selectedWindow] ?? leaves(model.windows)[0]
  return themedTextPlain(leaf.pane.body).split("\n")
}

export function modeline(editor: Editor, viewport = VIEWPORT): string {
  const model = display(editor, viewport)
  const leaf = leaves(model.windows)[editor.selectedWindow] ?? leaves(model.windows)[0]
  return themedTextPlain(leaf.pane.modeline)
}

export function echoArea(editor: Editor, viewport = VIEWPORT): string {
  return themedTextPlain(display(editor, viewport).echo)
}

/** All highlight spans in the selected window's syncSpans (region, isearch, paren). */
export function spans(editor: Editor, viewport = VIEWPORT) {
  const leaf = leaves(display(editor, viewport).windows)[editor.selectedWindow]
  return leaf?.pane.syncSpans ?? []
}
