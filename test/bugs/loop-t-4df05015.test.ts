import { expect, test } from "bun:test"
import { Keymap, KeymapStack, keyToken } from "../../src/kernel/keymap"

// t-4df05015: terminals report C-j as {name:'linefeed'}; keyToken must emit the
// canonical 'C-j' so direct consumers (KeymapStack.feed, readKey, unbound-key echo)
// reach the same binding as a literal 'C-j' sequence.
test("keyToken canonicalizes linefeed → C-j", () => {
  expect(keyToken({ name: "linefeed" })).toBe("C-j")
  expect(keyToken({ name: "linefeed", sequence: "\n" })).toBe("C-j")
})

test("KeymapStack.feed: linefeed event reaches a C-j binding", () => {
  const m = new Keymap("test")
  m.bind("C-j", "icomplete-fido-exit")
  const stack = new KeymapStack(() => [{ name: "test", keymap: m }])
  expect(stack.feed({ name: "linefeed", sequence: "\n" })).toMatchObject({ status: "matched", command: "icomplete-fido-exit" })
})
