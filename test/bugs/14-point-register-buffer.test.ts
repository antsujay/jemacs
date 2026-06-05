import { test } from "bun:test"
import { script } from "../harness"

test("jump-to-register restores the buffer point was saved in", async () => {
  await script()
    .text("hello world")
    .point(5)
    .run("point-to-register", "a")
    .do(e => e.scratch("B", "other text"))
    .expect.bufferName("B")
    .run("jump-to-register", "a")
    .expect.bufferName("*scratch*")
    .expect.point(5)
    .done()
})
