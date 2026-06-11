import { expect, test } from "bun:test"
import {
  buildLogicalModel,
  offsetTableMap,
  type LogicalPane,
  type LogicalWindowNode,
} from "../../src/display/logical"
import { FACE_REMAP_KEY, faceRemapAddRelative, resolveFace } from "../../src/runtime/faces"
import { defineMode } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"

// t-audit2-7eecc353: LogicalPane.buffer/.locals must be a snapshot. The earlier
// fix shallow-copied buffer.locals, but the FACE_REMAP_KEY entry is itself a
// Map that faceRemapAddRelative mutates in place — so resolveFace(.., pane.buffer)
// still saw post-build kernel mutations through the shared inner Map.
//
// t-audit2-f8e12ae6: displayMap is a function (dropped by JSON). The serializable
// descriptor (displayOffsets) is on the pane; offsetTableMap is exported so a
// host can reconstruct the closure on its side after a JSON round-trip.

function selectedPane(node: LogicalWindowNode): LogicalPane {
  if (node.kind === "leaf") return node.pane
  const l = selectedPane(node.first)
  return l.selected ? l : selectedPane(node.second)
}

test("face-remap snapshot: post-build faceRemapAddRelative does not leak into pane.buffer", () => {
  const editor = makeEditor()
  const buf = editor.scratch("x", "abc", "text")
  faceRemapAddRelative(buf, "default", { fg: "#aa0000" })
  const pane = selectedPane(buildLogicalModel(editor).windows)

  // Kernel mutates the live buffer's face-remap table after the model is built.
  faceRemapAddRelative(buf, "default", { fg: "#0000bb" })
  faceRemapAddRelative(buf, "comment", { italic: true })

  // The inner remap Map must have been snapshotted, not aliased.
  const liveRemaps = buf.locals.get(FACE_REMAP_KEY)
  expect(pane.locals.get(FACE_REMAP_KEY)).not.toBe(liveRemaps)
  expect(pane.buffer?.locals.get(FACE_REMAP_KEY)).not.toBe(liveRemaps)

  // resolveFace through the pane's snapshot must see pre-mutation state.
  const snap = resolveFace("default", editor.theme, pane.buffer)
  expect(snap?.fg).toBe("#aa0000")
  // Late-added remap entry must be absent from the snapshot's table.
  const snapRemaps = pane.locals.get(FACE_REMAP_KEY) as Map<string, unknown>
  expect(snapRemaps.has("comment")).toBe(false)
})

test("displayOffsets survives JSON; exported offsetTableMap reconstructs displayMap host-side", () => {
  defineMode({
    name: "hide4-mode",
    displayFilter: b => ({ text: b.text.slice(4), map: n => Math.max(0, n - 4) }),
  })
  const editor = makeEditor()
  const buf = editor.scratch("x", "----abcdef", "hide4-mode")
  buf.point = 7
  const pane = selectedPane(buildLogicalModel(editor).windows)

  // The function field is dropped by JSON; the descriptor is what survives.
  const wire = JSON.parse(JSON.stringify({ displayOffsets: pane.displayOffsets }))
  expect(Array.isArray(wire.displayOffsets)).toBe(true)
  const rebuilt = offsetTableMap(wire.displayOffsets)
  expect(rebuilt(7)).toBe(3)
  expect(pane.displayMap?.(7)).toBe(3)
})
