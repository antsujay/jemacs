import { expect, test } from "bun:test"
import { keyToPtyBytes } from "../../plugins/term"

test("term-send-raw maps named space/enter to bytes, not key.name", () => {
  expect(keyToPtyBytes({ name: "space" })).toBe(" ")
  expect(keyToPtyBytes({ name: "enter" })).toBe("\r")
  expect(keyToPtyBytes({ name: "a", sequence: "a" })).toBe("a")
  expect(keyToPtyBytes({ name: "up", raw: "\x1b[A" })).toBe("\x1b[A")
})
