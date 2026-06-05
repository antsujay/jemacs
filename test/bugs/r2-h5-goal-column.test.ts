import { test } from "bun:test"
import { script } from "../harness"

test("next-line preserves goal column across a short line", async () => {
  await script()
    .text("abcdef\nx\nghijkl")
    .point(5)
    .keys("C-n").expect.col(2)
    .keys("C-n").expect.col(6)
    .keys("C-p", "C-p").expect.col(6)
    .keys("C-f", "C-n", "C-n").expect.col(7)
    .done()
})
