import { test, expect } from "bun:test"
import { script, keySeq } from "../harness"

test("query-replace starts from point, not beginning of buffer", async () => {
  const ed = await script({ plugins: false }).text("aXa").point(2).done()
  const done = ed.run("query-replace", ["a", "b"])
  await keySeq(ed, "!")
  await done
  expect(ed.currentBuffer.text).toBe("aXb")
})
