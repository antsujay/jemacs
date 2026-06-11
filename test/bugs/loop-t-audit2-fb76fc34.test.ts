import { expect, test } from "bun:test"
import { buildDisplayModel } from "../../src/display/build-display-model"
import { defineMode } from "../../src/modes/mode"
import { addHook, clearHooks } from "../../src/kernel/hooks"
import type { WindowSplit } from "../../src/kernel/window"
import { makeEditor } from "../plugins/helper"

// t-audit2-fb76fc34: syncWindowBodyGeometry stores rows/cols on buffer.locals
// but is invoked once per *window*. Two splits showing the same buffer write
// in walk order, so the last-visited split's geometry wins — the selected
// window's pty/surface sees the wrong size, and the resize hook flaps every
// frame as the two leaves overwrite each other.
//
// t-audit2-d032ccb4: geometry only reached LogicalPane.locals because the
// buffer.locals mutation happened to precede the snapshot in buildLogicalModel.
// Reordering would silently drop it. Make the data flow explicit.
//
// t-audit2-84d7e59e: selectedVisualRows re-ran the mode's displayFilter (once
// directly, once via paneWrapLayout) after buildLogicalModel had already
// evaluated it for the same pane. Reuse the cached pane.displayText.

const viewport = { rows: 30, cols: 80 }
const perFaceFonts = { unit: "pixels", mouse: true, clipboard: true, osc52: false, perFaceFonts: true } as const

test("same buffer in two splits: selected window's geometry wins; hook does not flap", async () => {
  const editor = makeEditor()
  const buf = editor.scratch("term", "x", "text")
  await editor.run("split-window-below")
  // Skew the split so the two leaves get clearly different row budgets.
  ;(editor.windowLayout as WindowSplit).firstRatio = 0.75
  // Selected = first (top) leaf — split-window-below keeps focus on the original.
  expect((editor.windowLayout as WindowSplit).first.kind).toBe("leaf")
  expect((editor.windowLayout as WindowSplit).first).toMatchObject({ id: editor.selectedWindowId })

  let fires = 0
  addHook("window-configuration-change-hook", () => { fires++ })

  buildDisplayModel(editor, { viewport })
  const selectedRows = buf.locals.get("window-body-rows") as number
  // With ratio 0.75 the top (selected) leaf is the larger one; the bottom
  // (last-walked) leaf is smaller. Under the bug the smaller value wins.
  const otherRows = (() => {
    // Re-derive the bottom leaf's body rows independently of the code under test.
    const area = Math.max(2, 30 - 3) // contentAreaLines
    const first = Math.floor(area * 0.75)
    return Math.max(1, (area - first) - 1) // windowBodyLines(second)
  })()
  expect(selectedRows).toBeGreaterThan(otherRows)

  // Second frame with identical layout: geometry is unchanged, hook must not fire.
  const before = fires
  buildDisplayModel(editor, { viewport })
  expect(fires).toBe(before)
  expect(buf.locals.get("window-body-rows")).toBe(selectedRows)

  clearHooks()
})

test("displayFilter is evaluated once per visible pane per frame", async () => {
  let calls = 0
  defineMode({
    name: "count-filter-mode",
    displayFilter: b => { calls++; return { text: b.text, map: n => n } },
  })
  const editor = makeEditor()
  editor.scratch("f", "a\nb\nc\nd", "count-filter-mode")

  calls = 0
  buildDisplayModel(editor, { viewport, hostCapabilities: perFaceFonts })
  // One leaf showing the buffer → one displayFilter call. The post-layout
  // visual-row pass must reuse the logical pane's displayText.
  expect(calls).toBe(1)

  await editor.run("split-window-below")
  calls = 0
  buildDisplayModel(editor, { viewport, hostCapabilities: perFaceFonts })
  expect(calls).toBe(2)
})
