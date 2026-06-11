import { expect, test } from "bun:test"
import { buildDisplayModel } from "../../src/display/build-display-model"
import { defineMode } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"

// t-audit2-84d7e59e: selectedVisualRows re-ran the mode's displayFilter twice
// per frame — once via `modeFeature(...,"displayFilter")` directly, once via
// `paneWrapLayout` → `displayTextForBuffer`. buildLogicalModel had already
// evaluated it and cached the result on `pane.displayText`; reuse that.
//
// Fixed in drain-2 (6fdff66) alongside t-audit2-fb76fc34 by passing the
// LogicalPane through to selectedVisualRows and switching paneWrapLayout →
// paneWrapLayoutFor. This file pins the call-count invariant on its own id.

const perFaceFonts = { unit: "pixels", mouse: true, clipboard: true, osc52: false, perFaceFonts: true } as const

test("selectedVisualRows reuses pane.displayText (displayFilter runs once per frame)", () => {
  let calls = 0
  defineMode({
    name: "count-84d7e59e",
    displayFilter: b => { calls++; return { text: b.text.replace(/^#+ /gm, ""), map: n => n } },
  })
  const editor = makeEditor()
  editor.scratch("doc", "# h1\nbody\n## h2\nmore", "count-84d7e59e")

  calls = 0
  // perFaceFonts forces the selectedVisualRows path (visual-row weighting).
  buildDisplayModel(editor, { viewport: { rows: 24, cols: 80 }, hostCapabilities: perFaceFonts })
  // Under the bug: 3 (buildLogicalModel + direct modeFeature + paneWrapLayout).
  expect(calls).toBe(1)
})

test("non-GUI host skips selectedVisualRows entirely (still one filter call)", () => {
  let calls = 0
  defineMode({
    name: "count2-84d7e59e",
    displayFilter: b => { calls++; return { text: b.text, map: n => n } },
  })
  const editor = makeEditor()
  editor.scratch("doc", "a\nb", "count2-84d7e59e")

  calls = 0
  buildDisplayModel(editor, { viewport: { rows: 24, cols: 80 } })
  expect(calls).toBe(1)
})
