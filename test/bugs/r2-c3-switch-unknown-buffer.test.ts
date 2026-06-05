import { test, expect } from "bun:test"
import { script } from "../harness"

test("switch-to-buffer with unknown name creates buffer", async () => {
  await script()
    .run("switch-to-buffer", "newbuf")
    .expect.bufferName("newbuf")
    .expect.that((_, b) => expect(b.text).toBe(""))
    .done()
})
