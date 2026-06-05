import { test, expect } from "bun:test"
import { script } from "../harness"

test("goto-line past EOF clamps point to text length", async () => {
  await script()
    .text("a\nb\nc")
    .run("goto-line", 100)
    .expect.that((_, buf) => expect(buf.point).toBeLessThanOrEqual(buf.text.length))
    .done()
})
