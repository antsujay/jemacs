import { expect, test } from "bun:test"
import { keyToken } from "../../src/kernel/keymap"
import { getMode, modes } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"
import { install as installV1 } from "../../plugins/term"
import { install as installV2 } from "../../plugins/term-v2"

// t-ba640ab6 + t-92f9a440: term-map bound literal " " (normalizes to "") and
// only lowercase a-z, so space, uppercase, and shifted punctuation fell
// through to self-insert instead of reaching the pty.
for (const [tag, install] of [["term", installV1], ["term-v2", installV2]] as const) {
  test(`${tag}: every printable key event resolves to term-send-raw in term-map`, () => {
    modes.delete("term")
    const editor = makeEditor()
    install(editor)
    const map = getMode("term")!.keymap!
    const cases: Array<[string, Parameters<typeof keyToken>[0]]> = [
      ["space", { name: "space", sequence: " " }],
      ["upper Y", { name: "y", sequence: "Y", shift: true }],
      ["bang", { name: "!", sequence: "!", shift: true }],
      ["equals", { name: "=", sequence: "=" }],
      ["semicolon", { name: ";", sequence: ";" }],
      ["pipe", { name: "|", sequence: "|", shift: true }],
      ["tilde", { name: "~", sequence: "~", shift: true }],
    ]
    for (const [label, ev] of cases) {
      const tok = keyToken(ev)
      expect(map.get(tok), `${label} (token ${JSON.stringify(tok)})`).toBe("term-send-raw")
    }
  })
}
