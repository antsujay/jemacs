import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { install } from "../../plugins/wdired"
import { clearHooks } from "../../src/kernel/hooks"

// Repro for t-86c21ba5: inserting a blank line in a wdired buffer must not
// shift the rename pairing onto the wrong files. Fixed by the marker-tracking
// rewrite (8b0709a) — kept here to guard against regressing to index-zip.
test("wdired: inserting a newline must not cause misaligned renames", async () => {
  clearHooks()
  const dir = await mkdtemp(join(tmpdir(), "jemacs-wdired-ins-"))
  try {
    await writeFile(join(dir, "alpha.txt"), "alpha")
    await writeFile(join(dir, "beta.txt"), "beta")
    await writeFile(join(dir, "gamma.txt"), "gamma")
    const editor = makeEditor()
    install(editor)
    const buf = await editor.openDirectory(dir)
    await editor.run("wdired-change-to-wdired-mode")

    // Insert a newline at top of buffer — every entry line shifts down by one.
    buf.point = 0
    buf.insert("\n")
    let lastMessage = ""
    editor.events.on("message", ({ text }) => { lastMessage = text })
    await editor.run("wdired-finish-edit")

    // No file should have been touched: same names, same contents.
    expect(await readFile(join(dir, "alpha.txt"), "utf8")).toBe("alpha")
    expect(await readFile(join(dir, "beta.txt"), "utf8")).toBe("beta")
    expect(await readFile(join(dir, "gamma.txt"), "utf8")).toBe("gamma")
    expect(lastMessage).not.toMatch(/error/i)
  } finally {
    await rm(dir, { recursive: true, force: true })
    clearHooks()
  }
})
