import { expect, test } from "bun:test"
import { buildDisplayModel } from "../../src/display/build-display-model"
import { themedTextPlain } from "../../src/display/themed-text"
import { modeline } from "../harness/display"
import { makeEditor } from "../plugins/helper"

// t-e95ff513: echo area never auto-clears; isearch prompt double-renders.
// The minibuffer chunk and the echo chunk are two separate rows in the model.
// When isearch is active, buildMinibufferChunk emits the live prompt with a
// cursor, AND the kernel has already echoed the same prompt via editor.message
// — so run-core's lastMessage holds it too. Both rows render → two "I-search:"
// lines. Same shape for "Quit" under a fido prompt. The minibuffer/isearch
// prompt must own that screen space; echo carries only the pending-key hint.

const VIEW = { rows: 30, cols: 80 }

test("isearch active: echo line does not duplicate the prompt", async () => {
  const editor = makeEditor()
  editor.scratch("filter.go", "func hasTag() {}\n", "go")
  await editor.run("isearch-forward")
  editor.isearch!.string = "func hasTag"
  // run-core would have captured this from the kernel's message() call.
  const model = buildDisplayModel(editor, { lastMessage: "I-search: func hasTag", viewport: VIEW })
  const mini = themedTextPlain(model.minibuffer)
  const echo = themedTextPlain(model.echo)
  expect(mini).toContain("I-search: func hasTag")
  expect(echo).not.toContain("I-search")
})

test("minibuffer active: stale echo (Quit) is suppressed under fido", async () => {
  const editor = makeEditor()
  const opened = new Promise<void>(r => editor.events.on("minibuffer", () => r()))
  void editor.prompt("M-x ", "", undefined, { collection: ["alpha", "bravo"] })
  await opened
  const model = buildDisplayModel(editor, { lastMessage: "Quit", viewport: VIEW })
  expect(themedTextPlain(model.minibuffer)).toContain("M-x")
  expect(themedTextPlain(model.echo)).not.toContain("Quit")
  editor.minibufferCancel()
})

// t-9e792ef9: modeline shows raw 'mark=541' byte offset — leftover debug output.
// Render region size only while the mark is active (transient-mark semantics).
// BLOCKED: test/tui/smoke.test.ts:28,36 assert the literal `mark=\d+` format
// (including the markActive=false M-< case). Flip this together with that file.
test("modeline: no raw mark= byte offset; region size only while active", () => {
  const editor = makeEditor()
  const buf = editor.scratch("filter.go", "package filter\n\nfunc hasTag() {}\n", "go")
  buf.point = 0
  buf.mark = 28
  buf.markActive = true
  let ml = modeline(editor)
  expect(ml).not.toContain("mark=")
  expect(ml).toContain("(28 chars)")

  // After a non-shift-select motion the mark deactivates but stays set —
  // the modeline must drop the region indicator entirely.
  buf.markActive = false
  ml = modeline(editor)
  expect(ml).not.toContain("mark=")
  expect(ml).not.toContain("chars)")
})
