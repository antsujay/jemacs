import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { themedTextPlain } from "../../src/display/themed-text"
import { display, modeline, script } from "../harness"

test("uniquified buffer names reach modeline, title, and C-x b collection", async () => {
  const editor = await script().done()
  editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/a/same.txt", text: "a" }))
  const b = editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/b/same.txt", text: "b" }))
  editor.switchToBuffer(b.id)

  expect(editor.bufferDisplayName(b)).toBe("same.txt<b>")
  expect(modeline(editor)).toContain("same.txt<b>")
  expect(themedTextPlain(display(editor).title)).toContain("same.txt<b>")

  let seen: string[] | undefined
  editor.completingRead = (_prompt, opts) => { seen = opts.collection; return Promise.resolve(null) }
  await editor.run("switch-to-buffer")
  expect(seen).toContain("same.txt<a>")
  expect(seen).toContain("same.txt<b>")
  expect(seen!.filter(n => n === "same.txt")).toHaveLength(0)
})
