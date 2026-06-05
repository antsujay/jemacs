import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { script } from "../harness"

// t-50874b: C-x C-b name column must use the uniquified display name, not raw
// buffer.name — otherwise two same.txt rows are indistinguishable. t-75ceea
// covered modeline/title/C-x b but missed the *Buffer List* render.
test("list-buffers name column shows uniquified names for colliding basenames", async () => {
  const editor = await script().done()
  editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/a/same.txt", text: "a" }))
  editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/b/same.txt", text: "b" }))

  await editor.run("list-buffers")
  const list = editor.currentBuffer
  expect(list.name).toBe("*Buffer List*")

  const rows = list.text.split("\n").filter(l => l.includes("/tmp/qa-fix/"))
  expect(rows).toHaveLength(2)
  expect(rows[0]).toContain("same.txt<a>")
  expect(rows[1]).toContain("same.txt<b>")
  // No row should render the bare ambiguous "same.txt " in the name column.
  expect(rows.some(r => /  same\.txt\s/.test(r))).toBe(false)
})
