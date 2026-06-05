import { expect, test } from "bun:test"
import { script, display } from "../harness"
import { themedTextPlain } from "../../src/display/themed-text"

test("fido renders vertical candidates below the minibuffer on open", async () => {
  const ed = await script().done()
  const opened = new Promise<void>(r => ed.events.on("minibuffer", () => r()))
  void ed.prompt("Pick: ", "", undefined, { collection: ["alpha", "bravo", "charlie"] })
  await opened
  const rows = themedTextPlain(display(ed).minibuffer).split("\n")
  expect(rows.slice(1)).toEqual(["► alpha", "  bravo", "  charlie"])
  ed.minibufferCancel()
})
