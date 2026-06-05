import { test, expect } from "bun:test"
import { script, parseKey } from "../harness"

test("burst self-insert preserves per-key char (paste)", async () => {
  const ed = await script().text("").done()
  await Promise.all([..."abcXYZ"].map(c => ed.handleKey(parseKey(c))))
  expect(ed.currentBuffer.text).toBe("abcXYZ")
})
