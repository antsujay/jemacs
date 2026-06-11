import { expect, test } from "bun:test"
import {
  buildLogicalModel,
  offsetTableMap,
  paneDisplayMap,
  type LogicalPane,
  type LogicalWindowNode,
} from "../../src/display/logical"
import { defineMode } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"

// t-audit2-f8e12ae6: LogicalPane.displayMap is a function on a data type.
// Functions are dropped by JSON.stringify (so a host that round-trips the
// model loses the mapping silently) and the original value was the mode's
// `displayFilter` closure — which in real modes (org, markdown) captures the
// live buffer + fold table.
//
// Overlaps t-audit2-ab15abf8 / t-audit2-7eecc353 (drain-1/2): those replaced
// the mode's closure with a table-derived one and added the serializable
// `displayOffsets` descriptor + exported `offsetTableMap`. This file pins the
// closure-retention regression and adds the host-side `paneDisplayMap` helper
// so a JSON-round-tripped pane needs nothing but the descriptor.
//
// Removing `displayMap` from the type entirely is the end state but is blocked
// on a 1-line consumer migration in char-grid-layout.ts:155 / web-layout.ts:83
// (`pane.displayMap` → `paneDisplayMap(pane)`); tracked by the test.failing
// below.

function selectedPane(node: LogicalWindowNode): LogicalPane {
  if (node.kind === "leaf") return node.pane
  const l = selectedPane(node.first)
  return l.selected ? l : selectedPane(node.second)
}

function paneWithFilter(): { pane: LogicalPane; modeMapCalls: () => number } {
  let calls = 0
  defineMode({
    name: "fold-f8e12ae6",
    // Hide a 4-char prefix. The closure intentionally captures `calls` so the
    // test can detect whether the pane's displayMap is *this* closure.
    displayFilter: b => ({
      text: b.text.slice(4),
      map: n => { calls++; return Math.max(0, n - 4) },
    }),
  })
  const editor = makeEditor()
  const buf = editor.scratch("x", "----abcdef", "fold-f8e12ae6")
  buf.point = 6
  buf.mark = 8
  const pane = selectedPane(buildLogicalModel(editor).windows)
  return { pane, modeMapCalls: () => calls }
}

test("pane.displayMap is not the mode's closure (no large-closure retention)", () => {
  const { pane, modeMapCalls } = paneWithFilter()
  expect(pane.displayText).toBe("abcdef")
  const before = modeMapCalls()
  // If displayMap were `filt.map`, this call would bump `calls`.
  expect(pane.displayMap?.(6)).toBe(2)
  expect(modeMapCalls()).toBe(before)
  // An offset the renderer never asked about isn't in the table; the
  // table-derived map falls back to identity, whereas the mode's closure would
  // have computed n-4. Proves the closure was dropped, not wrapped.
  expect(pane.displayMap?.(5)).toBe(5)
})

test("paneDisplayMap reconstructs the mapping from a JSON-round-tripped pane", () => {
  const { pane } = paneWithFilter()
  // Only the plain-data fields cross the wire; Maps and functions are gone.
  const wire = JSON.parse(JSON.stringify({
    displayOffsets: pane.displayOffsets,
    point: pane.point,
    mark: pane.mark,
  }))
  expect((wire as { displayMap?: unknown }).displayMap).toBeUndefined()
  const map = paneDisplayMap(wire)
  expect(map).toBeDefined()
  expect(map!(6)).toBe(2)
  expect(map!(8)).toBe(4)
  // Agrees with the lower-level offsetTableMap on the raw descriptor.
  expect(map!(6)).toBe(offsetTableMap(wire.displayOffsets)(6))
})

test("paneDisplayMap is undefined when no display filter is active", () => {
  const editor = makeEditor()
  editor.scratch("x", "plain", "text")
  const pane = selectedPane(buildLogicalModel(editor).windows)
  expect(pane.displayOffsets).toBeUndefined()
  expect(paneDisplayMap(pane)).toBeUndefined()
})

// Architectural invariant — `LogicalModel` is the hand-off type and must be
// plain data. Blocked on the consumer migration noted in the file header;
// flip to `test` once char-grid-layout / web-layout read `paneDisplayMap(pane)`.
test.failing("LogicalPane carries no function-valued own-properties (plain data)", () => {
  const { pane } = paneWithFilter()
  for (const [k, v] of Object.entries(pane)) {
    expect(typeof v, `LogicalPane.${k}`).not.toBe("function")
  }
})
