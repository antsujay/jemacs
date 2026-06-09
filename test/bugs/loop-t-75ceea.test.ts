import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { themedTextPlain } from "../../src/display/themed-text"
import { display, modeline, script } from "../harness"

test("uniquified buffer names reach modeline, title, and C-x b collection", async () => {
  const editor = await script().done()
  const a = editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/a/same.txt", text: "a" }))
  const b = editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/b/same.txt", text: "b" }))
  editor.switchToBuffer(a.id)
  editor.switchToBuffer(b.id)

  expect(editor.bufferDisplayName(b)).toBe("same.txt<b>")
  expect(modeline(editor)).toContain("same.txt<b>")
  expect(themedTextPlain(display(editor).title)).toContain("same.txt<b>")

  let seen: { prompt?: string; collection?: string[]; initialValue?: string } = {}
  editor.completingRead = (prompt, opts) => {
    seen = { prompt, collection: opts.collection, initialValue: opts.initialValue }
    return Promise.resolve("")
  }
  await editor.run("switch-to-buffer")
  expect(seen.prompt).toContain("default same.txt<a>")
  expect(seen.initialValue).toBeUndefined()
  expect(seen.collection).toContain("same.txt<a>")
  expect(seen.collection).toContain("same.txt<b>")
  expect(seen.collection!.filter(n => n === "same.txt")).toHaveLength(0)
  expect(editor.currentBuffer.id).toBe(a.id)
})
