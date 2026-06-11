import { expect, test } from "bun:test"
import { addAdvice } from "../../src/runtime/advice"
import { addHook, getHooks } from "../../src/kernel/hooks"
import { makeEditor } from "../plugins/helper"
import { install as installElectricPair } from "../../plugins/electric-pair"

// t-f35ebf: loop-t-16055714's electric-pair undo cases fail in the full suite
// because earlier files leave entries in the process-global advice/hooks
// registries; makeEditor() returned a fresh Editor but inherited that state.
// Same class as t-20bc93 (which patched it locally with clearAdvice/clearHooks
// in beforeEach). Structural fix: makeEditor() resets the registries up front.

test("makeEditor() drops leftover process-global advice/hooks", async () => {
  // Pollute the way a prior file's script()/install() would.
  let staleRan = 0
  addAdvice("forward-char", { after: () => { staleRan++ } })
  addAdvice("save-buffer", { before: () => { staleRan++ } })
  addHook("before-save-hook", () => { staleRan++ })

  const editor = makeEditor()
  await editor.run("forward-char")
  expect(staleRan).toBe(0)
  // makeEditor() resets to whatever installDefaultConfig adds (e.g. diff-mode's
  // hook) — assert the leftover *test* hooks above are gone, not that it's empty.
  expect(getHooks("before-save-hook").every(h => h.toString() !== "() => { staleRan++ }")).toBe(true)

  // and the original electric-pair undo invariant still holds post-reset
  installElectricPair(editor)
  const buffer = editor.currentBuffer
  buffer.setText("", false)
  buffer.point = 0
  editor.enableMinorMode("electric-pair-mode")
  await editor.handleKey({ name: "{", sequence: "{" })
  expect(buffer.text).toBe("{}")
  buffer.undo()
  expect(buffer.text).toBe("")
})
