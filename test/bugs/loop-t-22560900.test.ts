import { test, expect } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"

// t-f49950: C-x C-f prefills cwd; typing an absolute path after it leaves
// `<cwd>//tmp/...` in the minibuffer. find-file substitutes on accept (so C-j
// opens the right file), but minibufferCollection() passed the raw string to
// fileCompletionCandidates → readdir on a non-existent literal path → [], so
// fido shows [No match] and tab/RET-select are dead until the prefix is cleared.
test("file completion: candidates resolve past // or /~ in minibuffer input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-ffslash-"))
  try {
    await writeFile(join(dir, "alpha.txt"), "")
    await writeFile(join(dir, "beta.txt"), "")
    const editor = makeEditor()
    void editor.prompt("Find file: ", "/nowhere/prefilled/", undefined, { completion: "file" })
    await new Promise(r => setTimeout(r, 0))
    expect(editor.minibuffer?.completion).toBe("file")

    editor.activeBuffer.setText(`/nowhere/prefilled/${dir}/`, false)
    editor.activeBuffer.point = editor.activeBuffer.text.length
    const cands = await editor.minibufferCollection()
    expect(cands).toContain(join(dir, "alpha.txt"))
    expect(cands).toContain(join(dir, "beta.txt"))

    editor.activeBuffer.setText("/nowhere/prefilled/~/", false)
    expect(editor.minibufferInput().startsWith("/nowhere")).toBe(false)

    editor.minibufferCancel()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
