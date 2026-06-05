import { expect, test } from "bun:test"
import { BufferModel } from "../src/kernel/buffer"
import { findBackward, findForward, isearchLazyHighlightSpans, isearchMatchSpan } from "../src/kernel/isearch"

test("isearchMatchSpan covers the full query at point", () => {
  const buffer = new BufferModel({ name: "x", text: "foo bar foo" })
  buffer.point = 8
  const span = isearchMatchSpan(buffer, { bufferId: buffer.id, string: "foo", direction: 1, startPoint: 0 })
  expect(span).toEqual({ start: 8, end: 11, face: "isearch" })
})

test("findForward and findBackward locate substrings", () => {
  const text = "foo bar foo"
  expect(findForward(text, "foo", 0)).toBe(0)
  expect(findForward(text, "foo", 1)).toBe(8)
  expect(findForward(text, "baz", 0)).toBeNull()
  expect(findBackward(text, "foo", 8)).toBe(0)
  expect(findBackward(text, "foo", text.length)).toBe(8)
})

test("isearchLazyHighlightSpans paints every other match", () => {
  const buffer = new BufferModel({ name: "x", text: "foo bar foo baz foo" })
  buffer.point = 8
  const state = { bufferId: buffer.id, string: "foo", direction: 1 as const, startPoint: 0 }
  expect(isearchLazyHighlightSpans(buffer, state)).toEqual([
    { start: 0, end: 3, face: "lazyHighlight" },
    { start: 16, end: 19, face: "lazyHighlight" },
  ])
  expect(isearchLazyHighlightSpans(buffer, { ...state, string: "" })).toEqual([])
})

test("isearchLazyHighlightSpans handles regexp and zero-width matches", () => {
  const buffer = new BufferModel({ name: "x", text: "ab12cd34" })
  buffer.point = 2
  const state = { bufferId: buffer.id, string: "[0-9]+", direction: 1 as const, startPoint: 0, regexp: true }
  expect(isearchLazyHighlightSpans(buffer, state)).toEqual([
    { start: 6, end: 8, face: "lazyHighlight" },
  ])
  // Zero-width pattern must terminate, not loop forever.
  expect(isearchLazyHighlightSpans(buffer, { ...state, string: "x*" }).length).toBeLessThanOrEqual(buffer.text.length + 1)
})
