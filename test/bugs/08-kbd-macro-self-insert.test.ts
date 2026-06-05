import { test } from "bun:test"
import { script } from "../harness"

test("kbd macro records and replays self-insert chars", async () => {
  await script()
    .text("")
    .keys("C-x", "(", "a", "b", "c", "C-x", ")", "C-x", "e")
    .expect.text("abcabc")
    .done()
})
