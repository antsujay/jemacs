import { expect, test } from "bun:test"
import { keyToken } from "../../src/kernel/keymap"
import { getMode, modes } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"
import { installBuiltinPlugins } from "../../plugins/builtin"
import { install as installTerm } from "../../plugins/term"
import { install as installTermV2, attachSession, makeXTerm, type TermSession } from "../../plugins/term-v2"
import type { Pty } from "../../plugins/term/pty"

// t-7e9391: term-v2 loads after term and its install() called
// defineMode({name:"term", keymap:new Keymap(...)}), replacing the mode entry
// and discarding term's already-populated keymap. v2 then rebound a (stale)
// key set and re-registered term-send-raw without v1's args[0] fix. The
// rebinding has since been brought in line with v1, but the keymap clobber
// itself must go: v2 should reuse v1's term-map so a future v1-only binding
// change isn't silently reverted by v2's load.

function fakePty(): Pty & { sent: string } {
  let sent = ""
  return {
    pid: 0,
    get sent() { return sent },
    write(d) { sent += d },
    resize() {}, onData() {}, onExit() {}, kill() {},
  }
}

test("term-v2 install reuses term's populated term-map (no clobber)", () => {
  modes.delete("term")
  const editor = makeEditor()
  installTerm(editor)
  const v1Map = getMode("term")!.keymap!
  // Sentinel: a binding only v1's keymap carries.
  v1Map.bind("C-c C-q", "term-line-mode")

  installTermV2(editor)
  const v2Map = getMode("term")!.keymap!
  expect(v2Map).toBe(v1Map)
  expect(v2Map.get("C-c C-q")).toBe("term-line-mode")
  expect(v2Map.get("space")).toBe("term-send-raw")
  expect(v2Map.get("S-h")).toBe("term-send-raw")
})

test("term-v2 after installBuiltinPlugins: space/S-h dispatch; term-send-raw honours args[0]", async () => {
  const editor = makeEditor()
  await installBuiltinPlugins(editor)

  const buf = editor.scratch("*term*", "")
  buf.mode = "term"

  expect(editor.keymaps.lookup(keyToken({ name: "space", sequence: " " }))).toMatchObject({
    status: "matched", command: "term-send-raw",
  })
  expect(editor.keymaps.lookup(keyToken({ name: "h", shift: true }))).toMatchObject({
    status: "matched", command: "term-send-raw",
  })

  const pty = fakePty()
  const session: TermSession = { pty, xt: makeXTerm(4, 20), rows: 4, cols: 20 }
  attachSession(buf, session)
  editor.lastKeyEvent = { name: "z", sequence: "z" }
  await editor.run("term-send-raw", ["A"])
  expect(pty.sent).toBe("A")
  session.xt.dispose()
})
