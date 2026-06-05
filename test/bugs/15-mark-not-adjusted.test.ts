import { test } from "bun:test"
import { script } from "../harness"

test("insert before mark adjusts mark position", async () => {
  await script()
    .text("hello")
    .mark(5)
    .point(0)
    .keys(..."xxx")
    .expect.mark(8)
    .done()
})
