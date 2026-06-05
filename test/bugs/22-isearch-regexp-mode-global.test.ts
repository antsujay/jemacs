import { test, expect } from "bun:test"
import { script, keySeq } from "../harness"

test("isearch regexp mode does not leak across editors", async () => {
  const b = await script().text("a.b").point(0).keys("C-s").done()
  expect(b.isearch?.regexp).toBeFalsy()
  await script().run("isearch-forward-regexp").done()
  await keySeq(b, ".")
  expect(b.currentBuffer.point).toBe(1)
})
