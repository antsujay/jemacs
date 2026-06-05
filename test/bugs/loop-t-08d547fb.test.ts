import { expect, test } from "bun:test"
import { Keymap } from "../../src/kernel/keymap"
import { keySeq } from "../harness/script"
import { makeEditor } from "../plugins/helper"

// t-08d547fb: fido/vertico/ivy each defineKey('minibuffer','down',...) at install();
// last loader wins the shared map regardless of which frontend is active. The active
// MinibufferCompletionFrontend carries its own keymap that shadows minibuffer-local-map.
test("minibuffer: active completion frontend's keymap shadows minibuffer-local-map", async () => {
  const editor = makeEditor()
  const ran: string[] = []
  editor.command("stale-down", () => { ran.push("stale") })
  editor.command("frontend-down", () => { ran.push("frontend") })

  // A different plugin's install() wrote the shared map last.
  editor.defineKey("minibuffer", "down", "stale-down")

  const keymap = new Keymap("test-frontend-map")
  keymap.bind("down", "frontend-down")
  editor.minibufferCompletionFrontend = { keymap }

  void editor.prompt("Test: ")
  expect(editor.minibuffer).not.toBeNull()

  await keySeq(editor, "down")
  expect(ran).toEqual(["frontend"])

  // With no frontend installed, fall through to the shared map as before.
  editor.minibufferCompletionFrontend = null
  await keySeq(editor, "down")
  expect(ran).toEqual(["frontend", "stale"])
})
