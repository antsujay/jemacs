import { expect, test } from "bun:test"
import { script } from "../harness"
import { createLeafWindow, listWindowLeaves, nextWindowId, splitWindowLeaf } from "../../src/kernel/window"

// Bug: C-x 3 then C-x o lands in the left pane, not the new right one.
// Emacs keeps selection on the original (left) leaf after split-window-right,
// so other-window should step to the right leaf.
//
// Verified in window.ts: splitWindowLeaf keeps the original id on `first` and
// the new id on `second`; listWindowLeaves walks first→second (L→R/T→B).
test("split-window-right keeps selection left; other-window goes right", async () => {
  await script()
    .run("split-window-right")
    .expect.that(ed => {
      const leaves = listWindowLeaves(ed.windowLayout)
      expect(leaves).toHaveLength(2)
      expect(ed.selectedWindowId).toBe(leaves[0]!.id)
    })
    .run("other-window")
    .expect.that(ed => {
      const leaves = listWindowLeaves(ed.windowLayout)
      expect(ed.selectedWindowId).toBe(leaves[1]!.id)
    })
    .done()
})

// The pure tree contract that makes the above work: original id stays on the
// first (left/top) child, new id on second; nextWindowId from the original
// lands on the new leaf.
test("splitWindowLeaf: original id on first child, next from original is second", () => {
  const root = createLeafWindow("buf", 0)
  const result = splitWindowLeaf(root, root.id, "horizontal", "buf", 0)
  const leaves = listWindowLeaves(result.layout)
  expect(leaves[0]!.id).toBe(root.id)
  expect(leaves[1]!.id).not.toBe(root.id)
  expect(nextWindowId(result.layout, root.id, 1)).toBe(leaves[1]!.id)
})

// deep-review: unknown id should not throw out of the tree walk — return the
// tree unchanged with found:false so the editor can message instead.
test("splitWindowLeaf on unknown id returns tree unchanged with found:false", () => {
  const root = createLeafWindow("buf", 0)
  const nested = splitWindowLeaf(root, root.id, "vertical", "buf", 0)
  const result = splitWindowLeaf(nested.layout, "no-such-id", "horizontal", "buf", 0)
  expect(result.found).toBe(false)
  expect(result.layout).toBe(nested.layout)
  expect(listWindowLeaves(result.layout)).toHaveLength(2)
})
