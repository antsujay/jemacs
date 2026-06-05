import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { install, flexCompleter } from "../../plugins/fido"

// t-009a0855: M-x 'grep' surfaced ▸dogfood-report (g-r-e-p is a subsequence of
// do[g]food-[rep]ort) because flexMatch's pattern.length/candidate.length score
// carried no gap penalty — the 4/14 scattered hit outranked a longer contiguous one.
test("fido: contiguous 'grep' run outranks the scattered dogfood-report subsequence", () => {
  const out = flexCompleter("grep", ["dogfood-report", "counsel-ripgrep"])
  expect(out[0]).toBe("counsel-ripgrep")
})

test("fido: install registers grep/rgrep so the exact name is always the top M-x candidate", () => {
  const editor = makeEditor()
  install(editor)
  expect(editor.commands.get("grep")).toBeDefined()
  expect(editor.commands.get("rgrep")).toBeDefined()
  const names = editor.commands.names()
  expect(flexCompleter("grep", names)[0]).toBe("grep")
  expect(flexCompleter("rgrep", names)[0]).toBe("rgrep")
})
