/**
 * t-audit2-5a2dfacd: `predict()` assumed one `.body-row` ⇔ one visual line and
 * stepped `colOffset` by ±1 code unit. Soft-wrap doesn't change `.body-row`
 * count but does change `textContent` layout, and astral codepoints occupy two
 * code units, so the optimistic caret could land mid-surrogate or read a stale
 * row length.
 *
 * The DOM-row → model-line dependency and the left/right surrogate stepping
 * were fixed in 20a92f9 (drain-1; coverage merged into
 * loop-t-audit2-6834dabf.test.ts). This file pins the remaining edge: `up` /
 * `down` clamp `colOffset` with `Math.min` and can still land *between* a
 * surrogate pair on the destination line.
 */

import { afterAll, beforeAll, expect, test } from "bun:test"

// `client-bridge.ts` has module-level side effects (reads `window`, opens a
// WebSocket, queries the DOM); stub just enough to let it evaluate so we can
// reach the pure `predictCursor` export.
const saved: Record<string, unknown> = {}
let predictCursor: typeof import("../../src/web/client-bridge").predictCursor

beforeAll(async () => {
  for (const k of ["window", "document", "location", "WebSocket", "requestAnimationFrame"]) {
    saved[k] = (globalThis as Record<string, unknown>)[k]
  }
  const noop = () => {}
  const fakeDoc = { getElementById: () => null, addEventListener: noop, querySelector: () => null }
  class FakeWS { onopen: unknown; onmessage: unknown; onclose: unknown; onerror: unknown
    send = noop; close = noop; readyState = 0 }
  Object.assign(globalThis, {
    window: { __JEMACS_TOKEN__: "t", document: fakeDoc, location: { host: "x" }, jemacs: undefined },
    document: fakeDoc,
    location: { host: "x" },
    WebSocket: FakeWS,
    requestAnimationFrame: undefined,
  })
  ;({ predictCursor } = await import("../../src/web/client-bridge"))
})

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) (globalThis as Record<string, unknown>)[k] = v
})

// `colOffset` splits a surrogate pair iff the code unit *at* that offset is a
// low surrogate (its high partner sits at `colOffset - 1`).
const midSurrogate = (s: string, i: number) =>
  i > 0 && i < s.length && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff

// Regression guard for the drain-1 fix: prediction reads model lines, not
// `.body-row` textContent, and left/right step a whole codepoint.
test("predictCursor: model-line lengths + codepoint left/right (drain-1 regression)", () => {
  const lines = ["a😀b", "xy"] // "a😀b".length === 4 code units
  expect(predictCursor({ row: 0, colOffset: 1 }, "right", lines)).toEqual({ row: 0, colOffset: 3 })
  expect(predictCursor({ row: 0, colOffset: 3 }, "left", lines)).toEqual({ row: 0, colOffset: 1 })
  expect(predictCursor({ row: 0, colOffset: 0 }, "end", lines)).toEqual({ row: 0, colOffset: 4 })
  expect(predictCursor({ row: 0, colOffset: 4 }, "down", lines)).toEqual({ row: 1, colOffset: 2 })
})

test("predictCursor: up/down clamp snaps off a surrogate half", () => {
  // line 1 starts with 😀 (high surrogate at 0, low at 1). Coming from col 1 on
  // the line above, `Math.min(1, len)` lands at col 1 — between the pair.
  const down = predictCursor({ row: 0, colOffset: 1 }, "down", ["abc", "😀x"])
  expect(down.row).toBe(1)
  expect(midSurrogate("😀x", down.colOffset)).toBe(false)

  const up = predictCursor({ row: 1, colOffset: 1 }, "up", ["😀x", "abc"])
  expect(up.row).toBe(0)
  expect(midSurrogate("😀x", up.colOffset)).toBe(false)
})
