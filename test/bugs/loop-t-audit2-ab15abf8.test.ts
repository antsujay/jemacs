import { expect, test, afterEach } from "bun:test"
import { buildLogicalModel, type LogicalPane, type LogicalWindowNode } from "../../src/display/logical"
import { themedTextPlain } from "../../src/display/themed-text"
import { defineMode } from "../../src/modes/mode"
import { setCustom } from "../../src/runtime/custom"
import type { BufferModel } from "../../src/kernel/buffer"
import { makeEditor } from "../plugins/helper"

// t-audit2-ab15abf8: user-supplied display callbacks (mode displayFilter,
// mode-line-misc-info) run unguarded inside buildLogicalModel. One buggy
// plugin takes the whole frame down. Guard each call site; fall back to
// identity / an inline error marker.
//
// t-audit2-7eecc353: LogicalPane.buffer/.locals aliased the live kernel
// objects, so a "snapshot" mutated under the renderer and couldn't be
// JSON-serialized without dragging the BufferModel along.
//
// t-audit2-f8e12ae6: displayMap was the mode's closure (captures buffer +
// fold table). JSON.stringify drops it; the closure pins the buffer. The
// pane now carries the mapped offsets the renderer needs as plain data.

function selectedPane(node: LogicalWindowNode): LogicalPane {
  if (node.kind === "leaf") return node.pane
  const l = selectedPane(node.first)
  return l.selected ? l : selectedPane(node.second)
}

afterEach(() => setCustom("mode-line-misc-info", []))

test("displayFilter throwing does not crash render; falls back to raw text", () => {
  defineMode({
    name: "boom-mode",
    displayFilter: () => { throw new Error("plugin bug") },
  })
  const editor = makeEditor()
  editor.scratch("x", "hello world", "boom-mode")
  const model = buildLogicalModel(editor)
  const pane = selectedPane(model.windows)
  expect(pane.displayText).toBe("hello world")
  expect(pane.displayMap).toBeUndefined()
})

test("mode-line-misc-info segment throwing renders an error marker, not a crash", () => {
  setCustom<Array<(b: BufferModel) => string>>("mode-line-misc-info", [
    () => " ok",
    () => { throw new Error("misc bug") },
  ])
  const editor = makeEditor()
  editor.scratch("x", "abc", "text")
  const model = buildLogicalModel(editor)
  const ml = themedTextPlain(selectedPane(model.windows).modeline)
  expect(ml).toContain(" ok")
  expect(ml).toContain("err")
})

test("pane.locals is a snapshot — mutating buffer.locals after build does not leak in", () => {
  const editor = makeEditor()
  const buf = editor.scratch("x", "abc", "text")
  buf.locals.set("probe", 1)
  const pane = selectedPane(buildLogicalModel(editor).windows)
  buf.locals.set("probe", 2)
  buf.locals.set("late", true)
  expect(pane.locals.get("probe")).toBe(1)
  expect(pane.locals.has("late")).toBe(false)
})

test("pane.buffer is a locals-only snapshot, not the live BufferModel", () => {
  const editor = makeEditor()
  const buf = editor.scratch("x", "abc", "text")
  const pane = selectedPane(buildLogicalModel(editor).windows)
  expect(pane.buffer).not.toBe(buf)
  // resolveFace(face, theme, pane.buffer) only reads .locals — that must survive,
  // and must be the same snapshot the pane carries directly.
  expect(pane.buffer?.locals as unknown).toBe(pane.locals)
})

test("displayMap closure does not retain the live buffer; mapped offsets are plain data", () => {
  defineMode({
    name: "fold-mode",
    // Hide the first 4 chars: "----rest" -> "rest".
    displayFilter: b => ({ text: b.text.slice(4), map: n => Math.max(0, n - 4) }),
  })
  const editor = makeEditor()
  const buf = editor.scratch("x", "----abcdef", "fold-mode")
  buf.point = 6 // raw offset → display offset 2
  const pane = selectedPane(buildLogicalModel(editor).windows)
  expect(pane.displayText).toBe("abcdef")
  // Serializable descriptor present and correct for the offsets the renderer needs.
  expect(pane.displayOffsets).toBeDefined()
  expect(new Map(pane.displayOffsets).get(6)).toBe(2)
  // Back-compat function still works, but is derived from displayOffsets — not the
  // mode's closure over `buf`.
  expect(pane.displayMap?.(6)).toBe(2)
  // No live BufferModel reachable from the pane.
  expect(pane.buffer).not.toBe(buf)
})
