import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { install } from "../../plugins/wdired"
import { clearHooks } from "../../src/kernel/hooks"

const exists = (p: string) => stat(p).then(() => true, () => false)

test("wdired: killing a line must not shift renames onto the wrong file", async () => {
  clearHooks()
  const dir = await mkdtemp(join(tmpdir(), "jemacs-wdired-shift-"))
  try {
    await writeFile(join(dir, "alpha.txt"), "alpha")
    await writeFile(join(dir, "beta.txt"), "beta")
    await writeFile(join(dir, "gamma.txt"), "gamma")
    const editor = makeEditor()
    install(editor)
    const buf = await editor.openDirectory(dir)
    await editor.run("wdired-change-to-wdired-mode")

    const at = buf.text.indexOf("alpha.txt")
    buf.deleteRange(buf.text.lastIndexOf("\n", at) + 1, buf.text.indexOf("\n", at) + 1)
    const g = buf.text.indexOf("gamma.txt")
    buf.deleteRange(g, g + "gamma.txt".length)
    buf.insert("renamed.txt")
    await editor.run("wdired-finish-edit")

    expect(await exists(join(dir, "alpha.txt"))).toBe(true)
    expect(await exists(join(dir, "beta.txt"))).toBe(true)
    expect(await readFile(join(dir, "beta.txt"), "utf8")).toBe("beta")
    expect(await exists(join(dir, "gamma.txt"))).toBe(false)
    expect(await readFile(join(dir, "renamed.txt"), "utf8")).toBe("gamma")
  } finally {
    await rm(dir, { recursive: true, force: true })
    clearHooks()
  }
})
