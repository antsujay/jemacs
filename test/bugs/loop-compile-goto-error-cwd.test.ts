import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { install } from "../../plugins/next-error"

test("compile-goto-error resolves relative paths against the buffer's default-directory", async () => {
  const editor = makeEditor()
  install(editor)
  const buf = editor.scratch("*compilation*", "sub/f.go:3:1: err\n", "grep")
  buf.locals.set("default-directory", "/tmp/x")
  buf.point = 0
  await editor.run("compile-goto-error")
  expect(editor.currentBuffer.path).toBe("/tmp/x/sub/f.go")
})
