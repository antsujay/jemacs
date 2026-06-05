import { test } from "bun:test"
import { script } from "../harness"

test("yank-pop replaces the just-yanked text, not the range after it", async () => {
  await script()
    .text("hello").mark(0).run("kill-region")
    .text("X").point(0)
    .run("yank")
    .run("yank-pop")
    .expect.text("helloX")
    .done()
})
