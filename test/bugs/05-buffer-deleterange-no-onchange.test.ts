import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"

test("deleteRange fires onTextChange", () => {
  const b = new BufferModel({ name: "x", text: "hello" })
  const events: Array<{ start: number; end: number; text: string }> = []
  b.onTextChange = e => events.push(e)
  b.deleteRange(1, 4)
  expect(b.text).toBe("ho")
  expect(events).toEqual([{ start: 1, end: 4, text: "" }])
})
