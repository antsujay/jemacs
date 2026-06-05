import { test, expect } from "bun:test"
import { script } from "../harness"

test("transpose-chars at end-of-buffer does not insert 'undefined'", async () => {
  await script()
    .text("ab")
    .run("transpose-chars")
    .expect.that((_, buf) => expect(buf.text).not.toContain("undefined"))
    .done()
})
