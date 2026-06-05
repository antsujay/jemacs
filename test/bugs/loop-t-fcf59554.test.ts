import { expect, test } from "bun:test"
import { script } from "../harness"
import { listWindowLeaves } from "../../src/kernel/window"

// t-fcf59554: C-x 3 then C-x o lands left, not right.
// Repro per bug report — two buffers, split right, other-window, switch buffer.
// Emacs: split-window-right keeps the original (left) leaf selected, so C-x o
// steps right and the buffer switch lands there.
//
// window.ts is clean: splitWindowLeaf puts original→first, new→second;
// listWindowLeaves walks first→second; nextWindowId(+1) from first hits second.
// Root cause is editor.ts splitWindowRight/Below reassigning
// `this.selectedWindowId = result.newWindowId` (the right leaf). Dropping that
// line — and the matching reliance in ensureOtherWindowSelected — is the fix,
// which lives outside src/kernel/window.ts. Leave failing until editor.ts owner
// lands it; see also loop-split-other-window.test.ts.
test.failing("t-fcf59554: C-x 3, C-x o, switch-buffer → right pane gets the new buffer", async () => {
  await script()
    .do(ed => {
      ed.scratch("task.go", "package task\n", "text")
      ed.scratch("filter.go", "package filter\n", "text")
      ed.switchToBuffer("task.go")
    })
    .keys("C-x", "3")
    .keys("C-x", "o")
    .run("switch-to-buffer", "filter.go")
    .expect.that(ed => {
      const [left, right] = listWindowLeaves(ed.windowLayout)
      expect(ed.buffers.get(left!.bufferId)?.name).toBe("task.go")
      expect(ed.buffers.get(right!.bufferId)?.name).toBe("filter.go")
      expect(ed.selectedWindowId).toBe(right!.id)
    })
    .done()
})
