import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { install as installFido, flexCompleter } from "../../plugins/fido"
import { install as installVertico } from "../../plugins/vertico"

// t-6ddd4d9e: vertico filterCandidates hard-codes startsWith, never consults
// editor.completer. With fido + vertico both enabled (stephen config), fido sets
// editor.completer=flexCompleter but vertico's frontend.refresh short-circuits the
// kernel path that would use it — flex matching is silently downgraded to prefix-only.
test("vertico filterCandidates consults editor.completer (flex via fido)", async () => {
  const editor = makeEditor()
  installFido(editor) // enables fido-vertical-mode → editor.completer = flexCompleter
  installVertico(editor)
  editor.enableMinorMode("vertico-mode")
  expect(editor.completer).toBe(flexCompleter)

  const result = editor.prompt("M-x ", "", undefined, {
    collection: ["find-file", "save-buffer", "describe-function"],
  })
  await editor.handleKey({ name: "f", sequence: "f" })
  await editor.handleKey({ name: "f", sequence: "f" })
  // "ff" flex-matches find-file (and describe-function); startsWith("ff") matches nothing.
  const text = editor.minibufferCompletionDisplay?.text ?? ""
  expect(text).toContain("find-file")
  editor.minibufferCancel()
  await result
})

test("vertico falls back to prefix matching when no completer is set", async () => {
  const editor = makeEditor()
  installVertico(editor)
  editor.enableMinorMode("vertico-mode")
  expect(editor.completer).toBeNull()

  const result = editor.prompt("M-x ", "", undefined, {
    collection: ["find-file", "save-buffer", "fformat"],
  })
  await editor.handleKey({ name: "f", sequence: "f" })
  await editor.handleKey({ name: "f", sequence: "f" })
  const text = editor.minibufferCompletionDisplay?.text ?? ""
  expect(text).toContain("fformat")
  expect(text).not.toContain("find-file")
  editor.minibufferCancel()
  await result
})
