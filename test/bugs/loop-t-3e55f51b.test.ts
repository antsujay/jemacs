import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { installBuiltinPlugins } from "../../plugins/builtin"

// t-3e55f51b: e26f323 added plugins/term-v2/ but builtin.ts kept loading only
// ./term, so M-x term ran v1 (mojibake from un-stripped escapes). term-v2 must
// be registered and load *after* term so its 'term' command/mode definitions win.
test("term-v2 is registered in builtins and overrides v1's `term` command", async () => {
  const editor = makeEditor()
  await installBuiltinPlugins(editor)
  const spec = editor.commands.get("term")
  expect(spec).toBeDefined()
  // v1: "(v1: raw output, no VT parser)"; v2: "(v2: @xterm/headless VT parser)"
  expect(spec!.description).toContain("@xterm/headless")
  expect(spec!.source?.file).toContain("plugins/term-v2/")
})
