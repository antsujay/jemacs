import { test, expect } from "bun:test"
import { script } from "../harness"

test("save-buffers-kill-terminal prompts for dirty file buffers before quitting", async () => {
  const ed = await script().done()
  ed.currentBuffer.path = "/tmp/jemacs-dirty.txt"
  ed.currentBuffer.kind = "file"
  ed.currentBuffer.setText("changed")
  let prompted = false
  ed.events.on("minibuffer", () => { prompted = true })
  void ed.run("save-buffers-kill-terminal")
  await new Promise(r => setTimeout(r, 10))
  expect(prompted).toBe(true)
  expect(ed.running).toBe(true)
  ed.minibufferAccept("q")
})

test("C-x s is bound to save-some-buffers", async () => {
  const ed = await script().done()
  expect(ed.commands.get("save-some-buffers")).toBeDefined()
  expect(ed.describeKey("C-x s")).toContain("save-some-buffers")
})
