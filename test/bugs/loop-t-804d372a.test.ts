import { expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Editor } from "../../src/kernel/editor"
import { installDefaultConfig } from "../../src/config"
import { installDefaultModes } from "../../src/modes/default-modes"
import { diredDoCopy, diredDoRename, diredMarkAll } from "../../src/modes/dired"

const exists = (p: string) => stat(p).then(() => true, () => false)

// erro-5: multi-file copy/rename loops have no per-entry catch — a mid-loop
// EXDEV/EACCES/ENOENT aborts the whole operation, refreshDiredBuffer never
// runs (listing lies about disk), and the user sees a raw stack trace.
test("dired-do-rename: partial failure still refreshes listing and reports N moved / K failed", async () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  let lastMessage = ""
  editor.events.on("message", ({ text }) => { lastMessage = text })
  const dir = await mkdtemp(join(tmpdir(), "jemacs-dired-partial-"))
  const dest = `${dir}-dest`
  try {
    for (const f of ["a.txt", "b.txt", "c.txt"]) await writeFile(join(dir, f), f)
    const buffer = await editor.openDirectory(dir)
    diredMarkAll(buffer)
    await rm(join(dir, "b.txt")) // rename(b) → ENOENT mid-loop

    const op = diredDoRename(editor, buffer, null)
    editor.activeBuffer.setText(dest, true)
    editor.activeBuffer.point = dest.length
    await editor.handleKey({ name: "return" })
    await expect(op).resolves.toBeUndefined() // must not surface raw stack trace

    expect(await exists(join(dest, "a.txt"))).toBe(true)
    expect(await exists(join(dest, "c.txt"))).toBe(true) // loop continued past failure
    expect(buffer.text).not.toContain("a.txt") // listing refreshed to match disk
    expect(lastMessage).toMatch(/Moved 2/)
    expect(lastMessage).toMatch(/1 failed.*b\.txt/)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(dest, { recursive: true, force: true })
  }
})

test("dired-do-copy: partial failure still refreshes and reports N copied / K failed", async () => {
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  let lastMessage = ""
  editor.events.on("message", ({ text }) => { lastMessage = text })
  const dir = await mkdtemp(join(tmpdir(), "jemacs-dired-cp-partial-"))
  const dest = `${dir}-dest`
  try {
    for (const f of ["a.txt", "b.txt", "c.txt"]) await writeFile(join(dir, f), f)
    const buffer = await editor.openDirectory(dir)
    diredMarkAll(buffer)
    await rm(join(dir, "b.txt")) // cp(b) → ENOENT mid-loop

    const op = diredDoCopy(editor, buffer, null)
    editor.activeBuffer.setText(dest, true)
    editor.activeBuffer.point = dest.length
    await editor.handleKey({ name: "return" })
    await expect(op).resolves.toBeUndefined()

    expect(await exists(join(dest, "a.txt"))).toBe(true)
    expect(await exists(join(dest, "c.txt"))).toBe(true)
    expect(lastMessage).toMatch(/Copied 2/)
    expect(lastMessage).toMatch(/1 failed.*b\.txt/)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(dest, { recursive: true, force: true })
  }
})
