import { test, expect } from "bun:test"
import { script, parseKey } from "../harness"
import { Keymap, KeymapStack } from "../../src/kernel/keymap"

test("ESC <k> resolves as M-<k> (esc-is-meta)", async () => {
  const ed = await script({ plugins: false })
    .do(e => { e.command("probe", () => {}); e.key("C-M-a", "probe") })
    .done()
  expect((await ed.handleKey(parseKey("ESC"))).status).toBe("pending")
  expect(await ed.handleKey(parseKey("C-a"))).toEqual({ status: "command", command: "probe" })
})

test("unmatched result carries the full pending sequence", () => {
  const km = new Keymap("g")
  km.bind("M-x", "execute-extended-command")
  const stack = new KeymapStack(() => [{ name: "g", keymap: km }])
  expect(stack.feed({ name: "escape" }).status).toBe("pending")
  const r = stack.feed({ name: "z", ctrl: true })
  expect(r.status).toBe("unmatched")
  expect(r.status === "unmatched" && r.sequence).toBe("esc C-z")
})
