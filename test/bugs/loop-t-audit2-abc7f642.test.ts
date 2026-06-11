import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { installDefaultConfig } from "../../src/config"
import { findWindowLeaf } from "../../src/kernel/window"
import { pageScrollLines } from "../../src/display/viewport"
import { displayBuffer, type DisplayBufferActionFunction } from "../../lisp/window-cmds"

const startLine = (ed: Editor) => findWindowLeaf(ed.windowLayout, ed.selectedWindowId)!.startLine

function setup() {
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.lastViewport = { rows: 20 }
  const page = pageScrollLines(20)
  const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n")
  const buffer = editor.scratch("recenter.txt", lines, "text")
  buffer.point = buffer.text.indexOf("line 40")
  return { editor, center: 39 - Math.floor(page / 2), top: 39, bottom: Math.max(0, 39 - page + 1) }
}

// t-audit2-abc7f642: cycle index must reset when last-command ≠ recenter-top-bottom.
// Before the fix the WeakMap entry was never cleared, so an intervening command
// left the next plain C-l continuing the stale cycle instead of recentering.
test("recenter-top-bottom cycle resets after an unrelated command", async () => {
  const { editor, center, top, bottom } = setup()

  await editor.run("recenter-top-bottom")
  expect(startLine(editor)).toBe(center)
  await editor.run("recenter-top-bottom")
  expect(startLine(editor)).toBe(top)

  await editor.run("forward-char")
  await editor.run("recenter-top-bottom")
  expect(startLine(editor)).toBe(center) // not `bottom` — cycle restarted
  await editor.run("recenter-top-bottom")
  expect(startLine(editor)).toBe(top)
  await editor.run("recenter-top-bottom")
  expect(startLine(editor)).toBe(bottom)
})

// t-audit2-e34d1fb9: every DisplayBufferActionFunction value is dispatched.
// Compile-time exhaustiveness lives in displayBuffer(); this exercises each
// declared action end-to-end so a runtime gap shows up as a thrown error.
test("displayBuffer dispatches every DisplayBufferActionFunction", () => {
  const editor = new Editor()
  installDefaultConfig(editor)
  editor.scratch("disp.txt", "x", "text")
  const actions = ["display-buffer-in-child-frame"] as const satisfies readonly DisplayBufferActionFunction[]
  for (const action of actions) {
    expect(() => displayBuffer(editor, "disp.txt", { action })).not.toThrow()
  }
  expect(() => displayBuffer(editor, "disp.txt", {})).not.toThrow()
})
