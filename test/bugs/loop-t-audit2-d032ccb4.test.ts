import { expect, test } from "bun:test"
import { buildDisplayModel } from "../../src/display/build-display-model"
import { defineMode } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"

// t-audit2-d032ccb4: the old shim ran syncWindowBodyGeometry *before*
// buildLogicalModel and wrote geometry into the live `buffer.locals`; the
// LogicalPane only picked it up because its locals were the same Map reference.
// Once snapshotLocals (t-audit2-7eecc353) decoupled them, that ordering became
// load-bearing — swap the two calls and the pane snapshot silently carries the
// previous frame's geometry. Fix: build the logical model first, then walk that
// tree and stamp geometry onto each pane's own snapshot, so the post-layout
// pass reads explicit per-pane state instead of whatever the live buffer
// happened to hold at snapshot time.
//
// t-audit2-84d7e59e (merged): the old selectedVisualRows reached back into the
// live BufferModel (paneWrapLayout → displayTextForBuffer, plus its own
// displayLines split), re-running the mode's displayFilter twice on top of the
// call buildLogicalModel had already made. It now takes the LogicalPane and
// reuses `pane.displayText` / `pane.locals`.

const viewport = { rows: 30, cols: 80 }
const perFaceFonts = { unit: "pixels", mouse: true, clipboard: true, osc52: false, perFaceFonts: true } as const

test("post-layout visual-row pass reads the LogicalPane snapshot, not the live buffer", () => {
  let calls = 0
  let textAtCall = ""
  defineMode({
    name: "df-count-d032",
    displayFilter: b => { calls++; textAtCall = b.text; return { text: b.text, map: n => n } },
  })
  const editor = makeEditor()
  const buf = editor.scratch("x", "one\ntwo\nthree", "df-count-d032")
  // Stale geometry as if a previous (larger) frame left it behind.
  buf.locals.set("window-body-rows", 999)

  calls = 0
  buildDisplayModel(editor, { viewport, hostCapabilities: perFaceFonts })

  // 84d7e59e: perFaceFonts routes through selectedVisualRows; it must reuse the
  // pane's cached displayText, not call back into the mode's displayFilter.
  expect(calls).toBe(1)
  expect(textAtCall).toBe("one\ntwo\nthree")

  // d032ccb4: buffer.locals reflects *this* frame's viewport regardless of the
  // snapshot ordering — the geometry sync writes it explicitly post-build.
  const rows = buf.locals.get("window-body-rows") as number
  expect(rows).not.toBe(999)
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThan(viewport.rows)
  expect(buf.locals.get("window-body-cols")).toBe(viewport.cols)
})

test("displayFilter runs once per visible pane even when selectedVisualRows is hot", async () => {
  let calls = 0
  defineMode({
    name: "df-split-d032",
    displayFilter: b => { calls++; return { text: b.text, map: n => n } },
  })
  const editor = makeEditor()
  editor.scratch("y", "a\nb\nc\nd", "df-split-d032")
  await editor.run("split-window-below")

  calls = 0
  buildDisplayModel(editor, { viewport, hostCapabilities: perFaceFonts })
  // Two leaves showing the buffer → two logical panes → two displayFilter calls.
  // selectedVisualRows (for the selected leaf) must not add a third or fourth.
  expect(calls).toBe(2)
})
