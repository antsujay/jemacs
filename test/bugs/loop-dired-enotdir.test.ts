import { expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { script } from "../harness"
import { diredOpen } from "../../src/modes/dired"

// C-x d via fido can hand back a *file* path; the dired command then calls
// openDirectory → makeDiredBuffer → readdir, which threw ENOTDIR uncaught.
test("dired on a file path lists the containing directory instead of throwing ENOTDIR", async () => {
  const dir = `/tmp/jemacs-dired-enotdir-${Date.now()}`
  await mkdir(dir, { recursive: true })
  await Bun.write(join(dir, "plain.txt"), "x")
  try {
    const editor = await script().run("dired", join(dir, "plain.txt")).done()
    expect(editor.currentBuffer.mode).toBe("dired")
    expect(editor.currentBuffer.path).toBe(dir)
    expect(editor.currentBuffer.text).toContain("plain.txt")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("diredOpen stats the target: dir → dired, file → visit, error → message", async () => {
  const dir = `/tmp/jemacs-diredopen-${Date.now()}`
  await mkdir(dir, { recursive: true })
  await Bun.write(join(dir, "f.txt"), "x")
  try {
    const editor = await script().done()
    const messages = [...editor.buffers.values()].find(b => b.name === "*messages*")!
    await diredOpen(editor, dir)
    expect(editor.currentBuffer.mode).toBe("dired")
    await diredOpen(editor, join(dir, "f.txt"))
    expect(editor.currentBuffer.name).toBe("f.txt")
    await diredOpen(editor, join(dir, "f.txt", "nope"))
    expect(messages.text).toContain("Not a directory")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
