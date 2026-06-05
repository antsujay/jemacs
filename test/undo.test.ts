import { expect, test } from "bun:test"
import { BufferModel } from "../src/kernel/buffer"

type ChangeEvent = { start: number; end: number; text: string }

test("undo and redo fire onTextChange", () => {
  const b = new BufferModel({ name: "x", text: "hello" })
  const events: ChangeEvent[] = []
  b.onTextChange = e => events.push(e)
  b.point = 5
  b.insert(" world")
  events.length = 0

  b.undo()
  expect(b.text).toBe("hello")
  // op-log undo: per-op delta, not full-replace — better for incremental LSP sync.
  expect(events).toEqual([{ start: 5, end: 11, text: "" }])

  events.length = 0
  b.redo()
  expect(b.text).toBe("hello world")
  expect(events).toEqual([{ start: 5, end: 5, text: " world" }])
})

test("undo across multiple edits restores correct point", () => {
  const b = new BufferModel({ name: "x", text: "abc" })
  b.point = 3
  b.insert("XYZ")
  b.insert("123")
  expect(b.text).toBe("abcXYZ123")
  expect(b.point).toBe(9)

  b.undo()
  expect(b.text).toBe("abcXYZ")
  expect(b.point).toBe(6)

  b.undo()
  expect(b.text).toBe("abc")
  expect(b.point).toBe(3)
  expect(b.point).toBeLessThanOrEqual(b.text.length)
})

test("redo after new edit clears redo stack", () => {
  const b = new BufferModel({ name: "x", text: "one" })
  b.point = 3
  b.insert(" two")
  b.undo()
  expect(b.text).toBe("one")

  b.insert(" three")
  expect(b.text).toBe("one three")

  b.redo()
  expect(b.text).toBe("one three")
})

test("undo in read-only buffer is no-op", () => {
  const b = new BufferModel({ name: "x", text: "locked" })
  b.readOnly = true
  const events: ChangeEvent[] = []
  b.onTextChange = e => events.push(e)

  expect(() => b.undo()).not.toThrow()
  expect(b.text).toBe("locked")
  expect(b.point).toBe(0)
  expect(events).toEqual([])
})
