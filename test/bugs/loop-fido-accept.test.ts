import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { install, flexScore } from "../../plugins/fido"

// inbox 14: M-x 'grep' fuzzy-matches dogfood-report and RET ran the wrong command.
test("fido: grep/rgrep are real commands so M-x 'grep' RET picks the exact match", async () => {
  expect(flexScore("grep", "dogfood-report")).not.toBeNull() // the trap
  const editor = makeEditor()
  install(editor)
  editor.command("dogfood-report", () => {}, "")
  expect(editor.commands.get("grep")).toBeDefined()
  expect(editor.commands.get("rgrep")).toBeDefined()
  const result = editor.completingRead("M-x ", { collection: editor.commands.names() })
  for (const ch of "grep") await editor.handleKey({ name: ch, sequence: ch })
  await editor.handleKey({ name: "return" })
  await expect(result).resolves.toBe("grep")
})

test("fido: RET on zero candidates messages [No match] and stays open; C-j exits literal", async () => {
  const editor = makeEditor()
  install(editor)
  let msg = ""
  editor.events.on("message", ({ text }) => { msg = text })
  const result = editor.completingRead("M-x ", { collection: ["find-file", "save-buffer"] })
  for (const ch of "qqq") await editor.handleKey({ name: ch, sequence: ch })
  await editor.handleKey({ name: "return" })
  expect(editor.minibuffer).not.toBeNull()
  expect(msg).toContain("[No match]")
  await editor.handleKey({ name: "j", ctrl: true })
  await expect(result).resolves.toBe("qqq")
})

// inbox 25: pin find-file literal-accept (C-j) and directory-descend (RET).
test("fido: find-file C-j accepts literal input; RET on a directory descends", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fido-accept-"))
  await mkdir(join(dir, "sub"))
  await writeFile(join(dir, "sub", "leaf.txt"), "")

  const editor = makeEditor()
  install(editor)
  const r1 = editor.completingRead("Find file: ", { completion: "file", initialValue: dir + "/" })
  for (const ch of "new.txt") await editor.handleKey({ name: ch, sequence: ch })
  await editor.handleKey({ name: "j", ctrl: true })
  await expect(r1).resolves.toBe(dir + "/new.txt")

  const r2 = editor.completingRead("Find file: ", { completion: "file", initialValue: dir + "/" })
  await editor.handleKey({ name: "s", sequence: "s" })
  await editor.handleKey({ name: "return" })
  expect(editor.minibuffer).not.toBeNull()
  expect(editor.minibufferInput()).toBe(join(dir, "sub") + "/")
  editor.minibufferCancel()
  await expect(r2).resolves.toBeNull()
})
