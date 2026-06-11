import { expect, test } from "bun:test"
import { buildLogicalModel } from "../../src/display/logical"
import type { SerializedPane, SerializedWindowNode } from "../../src/display/serialize"
import { webLayout } from "../../src/web/web-layout"
import { makeEditor } from "../plugins/helper"

// t-audit2-d91a6e9f: webLayout shipped the entire buffer twice per frame —
// once as themed `body`, once as raw `syncText`. Every keystroke serialized
// O(file size) over the WebSocket. Ship only the visible viewport instead.

function selectedPane(node: SerializedWindowNode): SerializedPane {
  if (node.kind === "leaf") return node.pane
  const l = selectedPane(node.first)
  return l.selected ? l : selectedPane(node.second)
}

const bodyText = (p: SerializedPane) => p.body.chunks.map(c => c.text).join("")

test("webLayout ships the visible viewport, not the whole buffer", () => {
  const editor = makeEditor()
  const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`)
  const buf = editor.scratch("big", lines.join("\n"), "text")
  buf.point = 0

  const viewport = { rows: 30 }
  const model = webLayout(buildLogicalModel(editor), viewport)
  const pane = selectedPane(model.windows)

  // Body is bounded by the viewport, not the file.
  const bodyLines = bodyText(pane).split("\n")
  expect(bodyLines.length).toBeLessThan(viewport.rows)
  expect(bodyLines[0]).toBe("line 0")

  // syncText is for the OpenTUI Textarea path; the web host never reads it.
  expect(pane.syncText.length).toBeLessThanOrEqual(bodyText(pane).length)

  // Wire payload is O(viewport), not O(file): a 1000-line buffer at ~7 chars
  // per line is ~7KB raw; the serialized frame must be well under that.
  expect(JSON.stringify(model).length).toBeLessThan(lines.join("\n").length)
})

test("webLayout cursor and clickState track the sliced viewport", () => {
  const editor = makeEditor()
  const lines = Array.from({ length: 200 }, (_, i) => `row ${i}`)
  const buf = editor.scratch("big", lines.join("\n"), "text")
  // Put point on row 100, col 4 and scroll there.
  buf.point = lines.slice(0, 100).join("\n").length + 1 + 4
  const leaf = editor.selectedWindowLeaf()!
  leaf.startLine = 90

  const model = webLayout(buildLogicalModel(editor), { rows: 30 })
  const pane = selectedPane(model.windows)
  const visible = bodyText(pane).split("\n")

  // Body starts at the scrolled-to line, not line 0.
  expect(visible[0]).toBe("row 90")
  expect(pane.clickState.startLine).toBe(90)

  // cursor.row indexes into the body slice (dom-frame: rows[cursor.row]).
  expect(pane.cursor).toEqual({ row: 10, colOffset: 4 })
  expect(visible[pane.cursor!.row]).toBe("row 100")
})
