import { expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { install } from "../../plugins/wdired"
import { clearHooks } from "../../src/kernel/hooks"

const exists = (p: string) => stat(p).then(() => true, () => false)

// t-ee05edb3: wdired makes the whole buffer writable; a stray edit into the
// prefix columns (mark/type/size/date) used to drop the marker via
// relocateByPrefix() → "(No changes to be performed)" with no clue why.

test("wdired: backspacing into the prefix column warns and the rename still applies", async () => {
  clearHooks()
  const dir = await mkdtemp(join(tmpdir(), "jemacs-wdired-prefix-"))
  try {
    await writeFile(join(dir, "alpha.txt"), "a")
    await writeFile(join(dir, "beta.txt"), "b")
    const editor = makeEditor()
    install(editor)
    const buf = await editor.openDirectory(dir)
    await editor.run("wdired-change-to-wdired-mode")

    const messages: string[] = []
    editor.events.on("message", ({ text }) => { messages.push(text) })

    // Backspace two chars past col NAME_OFFSET on alpha's line — corrupts the prefix.
    const at = buf.text.indexOf("alpha.txt")
    buf.deleteRange(at - 2, at)
    expect(messages.some(m => m.includes("filename column only"))).toBe(true)

    // Now rename alpha → renamed; the marker tracked across the prefix damage.
    const at2 = buf.text.indexOf("alpha.txt")
    buf.deleteRange(at2, at2 + "alpha.txt".length)
    buf.point = at2
    buf.insert("renamed.txt")
    await editor.run("wdired-finish-edit")

    expect(await exists(join(dir, "alpha.txt"))).toBe(false)
    expect(await exists(join(dir, "renamed.txt"))).toBe(true)
    expect(await exists(join(dir, "beta.txt"))).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
    clearHooks()
  }
})

test("wdired: C-a C-k then retype recovers the rename instead of silently ignoring", async () => {
  clearHooks()
  const dir = await mkdtemp(join(tmpdir(), "jemacs-wdired-kill-"))
  try {
    await writeFile(join(dir, "alpha.txt"), "a")
    await writeFile(join(dir, "beta.txt"), "b")
    const editor = makeEditor()
    install(editor)
    const buf = await editor.openDirectory(dir)
    await editor.run("wdired-change-to-wdired-mode")

    const messages: string[] = []
    editor.events.on("message", ({ text }) => { messages.push(text) })

    // C-a C-k on alpha's line: kill prefix + name, keep the newline.
    const at = buf.text.indexOf("alpha.txt")
    const ls = buf.text.lastIndexOf("\n", at) + 1
    const le = buf.text.indexOf("\n", at)
    buf.deleteRange(ls, le)
    expect(messages.some(m => m.includes("filename column only"))).toBe(true)

    // Retype just a bare name with no prefix.
    buf.point = ls
    buf.insert("renamed.txt")
    await editor.run("wdired-finish-edit")

    // Before the fix the marker was dropped → 0 renames, no error, no clue why.
    expect(await exists(join(dir, "alpha.txt"))).toBe(false)
    expect(await exists(join(dir, "renamed.txt"))).toBe(true)
    expect(await exists(join(dir, "beta.txt"))).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
    clearHooks()
  }
})
