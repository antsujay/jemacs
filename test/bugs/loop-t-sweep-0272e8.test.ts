import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { install } from "../../plugins/auto-revert"
import { setCustom } from "../../src/runtime/custom"
import { clearHooks } from "../../src/kernel/hooks"
import { clearAdvice } from "../../src/runtime/advice"

async function waitFor(pred: () => boolean, timeout = 2000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (pred()) return true
    await new Promise(r => setTimeout(r, 10))
  }
  return pred()
}

// t-sweep-0272e8: auto-revert-verbose echoed buffer.name, so two files with the
// same basename produced an ambiguous "Reverting buffer `a.txt'" message.
test("auto-revert-verbose message uses the uniquified display name", async () => {
  const root = await mkdtemp(join(tmpdir(), "jemacs-autorevert-uniq-"))
  const editor = makeEditor()
  try {
    install(editor)
    setCustom("auto-revert-interval", 0.02)
    setCustom("auto-revert-verbose", true)

    await mkdir(join(root, "x"), { recursive: true })
    await mkdir(join(root, "y"), { recursive: true })
    const pathA = join(root, "x", "a.txt")
    const pathB = join(root, "y", "a.txt")
    await writeFile(pathA, "one\n")
    await writeFile(pathB, "one\n")

    const a = await editor.openFile(pathA)
    const b = await editor.openFile(pathB)
    expect(a.name).toBe(b.name)
    const displayB = editor.bufferDisplayName(b)
    expect(displayB).not.toBe(b.name)

    const messages: string[] = []
    editor.events.on("message", ({ text }) => { messages.push(text) })

    await editor.run("global-auto-revert-mode")
    await writeFile(pathB, "two\n")
    const ok = await waitFor(() => b.text === "two\n")
    expect(ok).toBe(true)

    const revertMsg = messages.find(m => m.startsWith("Reverting buffer"))
    expect(revertMsg).toBe(`Reverting buffer \`${displayB}'`)
  } finally {
    if (editor.isMinorModeEnabled("global-auto-revert-mode")) {
      editor.disableMinorMode("global-auto-revert-mode")
    }
    clearHooks()
    clearAdvice()
    await rm(root, { recursive: true, force: true })
  }
})
