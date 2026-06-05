import { expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { script } from "../harness"

// t-873e8277: C-x d under fido — typing `dir/` then RET let fido accept the
// first child *file*; dired then readdir()'d that file path and threw ENOTDIR
// uncaught into the echo area. M-j (literal accept) was the only way through.
// dired now stats its argument and lists the parent when handed a file.
test("dired prompt + fido: RET on a typed `dir/` opens that dir, not ENOTDIR on its first child", async () => {
  const dir = `/tmp/jemacs-t-873e8277-${Date.now()}`
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "afile.txt"), "x")
  try {
    const editor = await script().done()
    // C-x d → minibuffer with file completion; fido is installed by script().
    const dired = editor.run("dired")
    await new Promise(r => setTimeout(r, 0))
    expect(editor.minibuffer?.completion).toBe("file")
    // Clear prefilled cwd, type the directory with a trailing slash.
    editor.activeBuffer.setText(dir + "/", false)
    editor.activeBuffer.point = dir.length + 1
    await editor.events.emit("minibuffer", { prompt: editor.minibuffer!.prompt })
    // fido's first candidate is the child file, not the typed dir.
    const fido = editor.activeBuffer.locals.get("fido") as { candidates: string[] }
    expect(fido.candidates[0]).toBe(join(dir, "afile.txt"))
    // RET — must not reject, and must land in dired on the *typed* directory.
    await editor.handleKey({ name: "return" })
    await expect(dired).resolves.toBeUndefined()
    expect(editor.currentBuffer.mode).toBe("dired")
    expect(editor.currentBuffer.path).toBe(dir)
    expect(editor.currentBuffer.text).toContain("afile.txt")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
