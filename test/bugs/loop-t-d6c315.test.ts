import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { installBuiltinPlugins } from "../../plugins/builtin"

// t-d6c315: 8b0709a added plugins/auto-save/ but builtin.ts never registered it,
// so M-x do-auto-save / recover-this-file are unbound and editor.startAutoSave()
// is never called — the kernel's #file# autosave machinery is dead at runtime.
test("auto-save is registered in builtins (do-auto-save / recover-this-file bound)", async () => {
  const editor = makeEditor()
  await installBuiltinPlugins(editor)
  expect(editor.commands.get("do-auto-save")).toBeDefined()
  expect(editor.commands.get("recover-this-file")).toBeDefined()
})
