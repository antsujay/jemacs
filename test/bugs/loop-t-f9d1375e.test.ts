import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { BufferModel } from "../../src/kernel/buffer"
import { modeline } from "../harness/display"

// t-f9d1375e: two buffers with the same basename must be distinguishable in the
// modeline and addressable by their uniquified name in switch-to-buffer.
test("uniquify: colliding basenames get <parent/dir> suffix", async () => {
  const root = await mkdtemp(join(tmpdir(), "jemacs-uniq-"))
  try {
    await mkdir(join(root, "go-cli", "task"), { recursive: true })
    await mkdir(join(root, "jemacs", "task"), { recursive: true })
    const pathA = join(root, "go-cli", "task", "task.go")
    const pathB = join(root, "jemacs", "task", "task.go")
    await writeFile(pathA, "package task // A\n")
    await writeFile(pathB, "package task // B\n")

    const editor = makeEditor()
    const a = await editor.openFile(pathA)
    expect(editor.bufferDisplayName(a)).toBe("task.go")

    const b = await editor.openFile(pathB)
    // Both buffers keep the bare basename; uniquify is a non-destructive overlay.
    expect(a.name).toBe("task.go")
    expect(b.name).toBe("task.go")
    // Immediate parents are both "task" → suffix widens to the first differing segment.
    expect(editor.bufferDisplayName(a)).toBe("task.go<go-cli/task>")
    expect(editor.bufferDisplayName(b)).toBe("task.go<jemacs/task>")

    // Modeline shows the uniquified name, so the header is no longer ambiguous.
    expect(modeline(editor)).toContain("task.go<jemacs/task>")

    // C-x b by uniquified name selects the intended buffer (the original
    // bug: "C-x b 'task.go' picks one arbitrarily — I killed the real one").
    editor.switchToBuffer("task.go<go-cli/task>")
    expect(editor.currentBuffer.id).toBe(a.id)
    editor.switchToBuffer("task.go<jemacs/task>")
    expect(editor.currentBuffer.id).toBe(b.id)

    // Killing one collapses the survivor back to the bare basename.
    editor.killBuffer(b.id)
    expect(editor.bufferDisplayName(a)).toBe("task.go")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("uniquify: pathless duplicates fall back to ordinal suffix", () => {
  const editor = makeEditor()
  const a = editor.addBuffer(new BufferModel({ name: "scratch.txt" }))
  const b = editor.addBuffer(new BufferModel({ name: "scratch.txt" }))
  expect(editor.bufferDisplayName(a)).not.toBe(editor.bufferDisplayName(b))
  expect(editor.bufferDisplayName(b)).toMatch(/^scratch\.txt<\d+>$/)
})

// t-3aed4969 + t-72bbff3d: write-file goes through buffer.save(), so once the
// command layer threads SaveContext the hooks and FOO~ backup fire on every
// save path — verified here at the BufferModel level without command advice.
test("write-file path: save() with ctx fires hooks and backs up once", async () => {
  const root = await mkdtemp(join(tmpdir(), "jemacs-uniq-"))
  try {
    const path = join(root, "out.txt")
    await writeFile(path, "disk\n")
    const buf = await BufferModel.fromFile(path)
    buf.setText("edited\n")

    const seen: string[] = []
    await buf.save({ runHook: async name => { seen.push(name) } })
    expect(seen).toEqual(["before-save-hook", "after-save-hook"])
    expect(await readFile(path + "~", "utf8")).toBe("disk\n")
    expect(await readFile(path, "utf8")).toBe("edited\n")

    buf.setText("edited again\n")
    await buf.save({ runHook: async name => { seen.push(name) }, makeBackupFiles: true })
    // backedUp gates per-session: backup~ is not rewritten on the second save.
    expect(await readFile(path + "~", "utf8")).toBe("disk\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
