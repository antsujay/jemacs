import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { getMode } from "../../src/modes/mode"
import { defcustom, getCustom, getCustomVariable, resetCustom } from "../../src/runtime/custom"

// t-84506ffb: the *Customize* help line advertises r/u/d/g but customize-mode-map
// bound none of them and no reset/refresh commands existed, so the keys were dead.
// resetCustom/resetCustomToSaved were exported from runtime/custom but never wired.
test("customize-mode: every key the help line advertises is actually bound", async () => {
  const editor = makeEditor()
  defcustom("jemacs-t84506ffb-flag", "boolean", false, "t-84506ffb test option")

  await editor.run("customize-variable", ["jemacs-t84506ffb-flag"])
  const help = editor.currentBuffer.text.split("\n").find(l => l.startsWith("Keys: "))!
  const keymap = getMode("customize-mode")!.keymap!
  for (const [, key] of help.matchAll(/\b([a-z])\b/g)) {
    const cmd = keymap.get(key!)
    expect(cmd, `help line advertises '${key}' but customize-mode-map binds nothing`).toBeDefined()
    expect(editor.commands.get(cmd!), `'${key}' is bound to '${cmd}' which is not a command`).toBeDefined()
  }

  // r → reset to standard: set, reset, observe baseline restored
  await editor.run("customize-set-variable", ["jemacs-t84506ffb-flag", "true"])
  expect(getCustom<boolean>("jemacs-t84506ffb-flag")).toBe(true)
  await editor.run(keymap.get("r")!)
  expect(getCustom<boolean>("jemacs-t84506ffb-flag")).toBe(false)
  expect(getCustomVariable("jemacs-t84506ffb-flag")?.customized).toBe(false)
  expect(editor.currentBuffer.text).toContain("State: STANDARD")

  // u → reset to saved: save true, set false, reset-saved, observe saved value restored
  await editor.run("customize-save-variable", ["jemacs-t84506ffb-flag", "true"])
  await editor.run("customize-set-variable", ["jemacs-t84506ffb-flag", "false"])
  expect(getCustom<boolean>("jemacs-t84506ffb-flag")).toBe(false)
  await editor.run(keymap.get("u")!)
  expect(getCustom<boolean>("jemacs-t84506ffb-flag")).toBe(true)
  expect(editor.currentBuffer.text).toContain("State: SAVED and set")

  // g → refresh keeps us in the customize buffer
  await editor.run(keymap.get("g")!)
  expect(editor.currentBuffer.name).toBe("*Customize*")

  resetCustom("jemacs-t84506ffb-flag")
})
