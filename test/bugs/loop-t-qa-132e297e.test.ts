import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { installBuiltinPlugins } from "../../plugins/builtin"
import { getMode } from "../../src/modes/mode"

// t-qa-132e297e: wdired's install() ends with editor.defineKey("dired-map", ...),
// which throws "Unknown keymap: dired-map" if installBuiltinPlugins runs before
// installDefaultModes(). The catch in builtin.ts swallows it, so wdired silently
// never loads. builtin.ts must ensure dired is installed before wdired.
test("installBuiltinPlugins: wdired loads without prior installDefaultModes()", async () => {
  const editor = new Editor()
  const failed: string[] = []
  editor.events.on("message", ({ text }) => { if (text.includes("failed")) failed.push(text) })
  await installBuiltinPlugins(editor)
  expect(failed.filter(m => m.includes("wdired"))).toEqual([])
  expect(editor.commands.get("wdired-change-to-wdired-mode")).toBeDefined()
  expect(getMode("dired")?.keymap).toBeDefined()
})
