import { expect, test } from "bun:test"
import { pointFromWindowClick, windowClickState } from "../src/display/click-to-point"

test("pointFromWindowClick maps row/col to buffer offset", () => {
  const text = "abcdef\nghijkl"
  const state = windowClickState(text, 0, 2, false)
  expect(pointFromWindowClick(text, state, 0, 2, 2)).toBe(2)
  expect(pointFromWindowClick(text, state, 1, 1, 2)).toBe(8)
})

test("pointFromWindowClick respects line-number gutter", () => {
  const text = "alpha\nbeta"
  const state = windowClickState(text, 0, 2, true)
  expect(state.gutterPrefixLen).toBeGreaterThan(0)
  const point = pointFromWindowClick(text, state, 0, state.gutterPrefixLen, 2)
  expect(point).toBe(0)
})
