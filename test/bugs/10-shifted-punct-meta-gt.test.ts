import { test } from "bun:test"
import { script } from "../harness"

test("M-> with terminal-reported shift:true resolves to end-of-buffer", async () => {
  await script()
    .text("hello world")
    .point(0)
    .keys({ name: ">", shift: true, meta: true, sequence: ">" })
    .expect.point(11)
    .done()
})
