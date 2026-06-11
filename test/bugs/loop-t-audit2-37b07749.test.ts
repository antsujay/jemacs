import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { findWindowLeaf } from "../../src/kernel/window"
import { pageScrollLines } from "../../src/display/viewport"
import { install as installWindowCmds, displayBuffer, type DisplayBufferActionFunction } from "../../lisp/window-cmds"

// ── t-audit2-37b07749: C-M-v clobbered ──────────────────────────────────────
// window-cmds bound C-M-v → scroll-other-window then M-C-v →
// scroll-other-window-down. normalizeToken canonicalises modifier order, so
// M-C-v *is* C-M-v and the second bind overwrote the first, leaving
// scroll-other-window unreachable from the keyboard. GNU Emacs binds
// scroll-other-window-down to C-M-S-v.
test("window-cmds: C-M-v reaches scroll-other-window (not shadowed by -down)", () => {
  const editor = new Editor()
  installWindowCmds(editor)
  expect(editor.keymap.get("C-M-v")).toBe("scroll-other-window")
  expect(editor.keymap.get("C-M-S-v")).toBe("scroll-other-window-down")
})

// ── t-audit2-abc7f642: recenter-top-bottom cycle never resets ───────────────
// The center→top→bottom index persisted across unrelated commands, so C-l
// after any intervening command jumped to "top" instead of recentering.
// Emacs resets when last-command ≠ recenter-top-bottom.
test("recenter-top-bottom: cycle resets after an unrelated command", async () => {
  const editor = new Editor()
  installWindowCmds(editor)
  editor.lastViewport = { rows: 20 }
  const page = pageScrollLines(20)
  const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n")
  const buffer = editor.scratch("recenter.txt", lines, "text")
  buffer.point = buffer.text.indexOf("line 40")
  const startLine = () => findWindowLeaf(editor.windowLayout, editor.selectedWindowId)!.startLine
  const center = 39 - Math.floor(page / 2)

  await editor.run("recenter-top-bottom")
  expect(startLine()).toBe(center)
  await editor.run("recenter-top-bottom")
  expect(startLine()).toBe(39) // top — consecutive C-l still cycles

  await editor.run("next-window-any-frame") // unrelated command
  await editor.run("recenter-top-bottom")
  expect(startLine()).toBe(center) // reset to center, not bottom
})

// ── t-audit2-e34d1fb9: DisplayBufferActionFunction vs displayBuffer() ───────
// Type listed 4 actions; displayBuffer() only branched on one. Type is now
// shrunk to the dispatched action so callers can't request unimplemented
// behaviour. This block is a compile-time exhaustiveness check — if a new
// action is added to the union without a branch in displayBuffer(), the
// `never` assignment fails to typecheck.
test("displayBuffer: every DisplayBufferActionFunction is dispatched", () => {
  const dispatched = (action: DisplayBufferActionFunction): true => {
    switch (action) {
      case "display-buffer-in-child-frame": return true
      default: { const _exhaustive: never = action; void _exhaustive; return true }
    }
  }
  void dispatched
  // Runtime: the one remaining action still routes to a child frame.
  const editor = new Editor()
  installWindowCmds(editor)
  editor.scratch("target", "", "text")
  const frame = displayBuffer(editor, "target", { action: "display-buffer-in-child-frame" })
  expect("window" in frame).toBe(true)
})
