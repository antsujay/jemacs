import { expect, test } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BufferModel } from "../../src/kernel/buffer"

// t-3aed4969 (refactor): before/after-save-hook run inside BufferModel.save()
// — the basic-save-buffer sequence — so write-file / find-alternate-file, which
// call buffer.save() directly, get hooks without command-layer advice.
//
// t-72bbff3d (feature): make-backup-files. First save() of a visited file
// copies the on-disk bytes to FOO~ before overwriting; gated per-session by
// bufferBackedUp and suppressible via SaveContext.makeBackupFiles.

test("save() runs before/after-save-hook around the write, independent of caller", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-t-3aed4969-"))
  try {
    const path = join(dir, "f.txt")
    const b = new BufferModel({ name: "f.txt", path, text: "body\n", kind: "file" })
    const seen: string[] = []
    await b.save({
      runHook: async name => { seen.push(name) },
      makeBackupFiles: false,
    })
    expect(seen).toEqual(["before-save-hook", "after-save-hook"])
    expect(await readFile(path, "utf8")).toBe("body\n")
    expect(b.dirty).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("first save() backs up the on-disk file to FOO~; later saves do not rewrite it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-t-3aed4969-"))
  try {
    const path = join(dir, "f.txt")
    await writeFile(path, "v0\n")
    const b = await BufferModel.fromFile(path)
    b.setText("v1\n")
    await b.save()
    expect(await readFile(path + "~", "utf8")).toBe("v0\n")
    expect(await readFile(path, "utf8")).toBe("v1\n")

    b.setText("v2\n")
    await b.save()
    expect(await readFile(path + "~", "utf8")).toBe("v0\n")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("makeBackupFiles=false suppresses the FOO~ write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-t-3aed4969-"))
  try {
    const path = join(dir, "g.txt")
    await writeFile(path, "orig")
    const b = await BufferModel.fromFile(path)
    b.setText("new")
    await b.save({ makeBackupFiles: false })
    await expect(readFile(path + "~", "utf8")).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe("new")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
