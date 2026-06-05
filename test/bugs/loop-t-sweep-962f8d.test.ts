import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { readInteractiveArgs } from "../../src/runtime/interactive"
import { script } from "../harness"

// t-sweep-962f8d — readInteractiveArgs 'b'/'B' built the completion collection
// from raw buffer.name, so duplicate basenames showed as identical entries in
// the prompt. switchToBuffer/killBuffer already resolve display names, so the
// collection just needs to feed bufferDisplayName(b) and the round-trip works.
test("interactive 'b' code: collection uses uniquified display names", async () => {
  const editor = await script().done()
  editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/a/same.txt" }))
  editor.addBuffer(new BufferModel({ name: "same.txt", path: "/tmp/qa-fix/b/same.txt" }))

  let seen: string[] | undefined
  editor.completingRead = (_prompt, opts) => { seen = opts.collection; return Promise.resolve(opts.collection?.[0] ?? null) }
  await readInteractiveArgs(editor, "(b)Buffer: ")

  expect(seen).toContain("same.txt<a>")
  expect(seen).toContain("same.txt<b>")
  expect(seen!.filter(n => n === "same.txt")).toHaveLength(0)
})
