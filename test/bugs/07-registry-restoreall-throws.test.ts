import { expect, test } from "bun:test"
import { CommandRegistry } from "../../src/kernel/command"

test("CommandRegistry.restoreAll() does not throw", () => {
  const reg = new CommandRegistry()
  reg.define("noop", () => {})
  expect(() => reg.restoreAll()).not.toThrow()
})
