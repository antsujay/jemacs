import { test, expect } from "bun:test"
import { script } from "../harness"

test("find-file prefill is a directory ending in /", async () => {
  const ed = await script().done()
  const opened = new Promise<void>(r => ed.events.on("minibuffer", () => r()))
  void ed.run("find-file")
  await opened
  expect(ed.minibufferInput()).toMatch(/\/$/)
  ed.minibufferCancel()
})
