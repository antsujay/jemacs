import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { install } from "../../plugins/fido"

// t-78aae07a: C-x C-f then type a path; RET picks fido's first candidate, and
// there was no obvious "use what I typed" key. Emacs fido has M-j for literal
// exit and `/` to descend into the highlighted directory. M-j was already
// wired (pinned below); `/`-descend was missing.
test("fido find-file: M-j submits literal; '/' descends into the highlighted dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fido-slash-"))
  await mkdir(join(dir, "sub"))
  await writeFile(join(dir, "sub", "leaf.txt"), "")
  await writeFile(join(dir, "sibling.txt"), "")

  const editor = makeEditor()
  install(editor)

  // M-j: literal exit even with a candidate highlighted (the "use what I typed" key).
  const r1 = editor.completingRead("Find file: ", { completion: "file", initialValue: dir + "/" })
  for (const ch of "nope/") await editor.handleKey({ name: ch, sequence: ch })
  await editor.handleKey({ name: "j", meta: true })
  await expect(r1).resolves.toBe(dir + "/nope/")

  // '/': with a directory candidate highlighted, descend instead of self-inserting.
  const r2 = editor.completingRead("Find file: ", { completion: "file", initialValue: dir + "/" })
  await editor.handleKey({ name: "s", sequence: "s" })
  expect(editor.activeBuffer.text).toContain("► " + join(dir, "sub") + "/")
  await editor.handleKey({ name: "/", sequence: "/" })
  expect(editor.minibufferInput()).toBe(join(dir, "sub") + "/")
  expect(editor.activeBuffer.text).toContain("leaf.txt")

  // '/': with a non-directory candidate highlighted, fall through to self-insert.
  await editor.handleKey({ name: "backspace" }) // up to dir/
  for (const ch of "sib") await editor.handleKey({ name: ch, sequence: ch })
  expect(editor.activeBuffer.text).toContain("► " + join(dir, "sibling.txt"))
  await editor.handleKey({ name: "/", sequence: "/" })
  expect(editor.minibufferInput()).toBe(dir + "/sib/")
  editor.minibufferCancel()
  await expect(r2).resolves.toBeNull()

  // '/': outside file completion it must stay a plain self-insert.
  const r3 = editor.completingRead("M-x ", { collection: ["find-file"] })
  await editor.handleKey({ name: "/", sequence: "/" })
  expect(editor.minibufferInput()).toBe("/")
  editor.minibufferCancel()
  await expect(r3).resolves.toBeNull()
})
