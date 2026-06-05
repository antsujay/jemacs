import { expect, test } from "bun:test"
import { mkdtemp, rm, readFile, writeFile, access, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BufferModel } from "../src/kernel/buffer"
import { resolveBackupPath } from "../src/kernel/backup-path"

test("resolveBackupPath: default when alist empty", () => {
  expect(resolveBackupPath("/tmp/foo.txt", [])).toBeUndefined()
  expect(resolveBackupPath("/tmp/foo.txt", undefined)).toBeUndefined()
})

test("resolveBackupPath: absolute directory uses ! path encoding", () => {
  const backupDir = "/var/tmp/backups"
  const file = "/home/user/project/file.txt"
  expect(resolveBackupPath(file, [[".", backupDir]])).toBe(
    join(backupDir, "!home!user!project!file.txt~"),
  )
})

test("resolveBackupPath: relative directory uses basename~ in subdir", () => {
  const file = "/home/user/project/file.txt"
  expect(resolveBackupPath(file, [[".", ".~"]])).toBe("/home/user/project/.~/file.txt~")
})

test("resolveBackupPath: null directory suppresses backup", () => {
  expect(resolveBackupPath("/remote/file.txt", [["/remote/", null]])).toBeNull()
})

test("save() writes backup to backup-directory-alist target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-backup-alist-"))
  const backupRoot = join(dir, "backups")
  try {
    const path = join(dir, "work", "f.txt")
    await mkdir(join(dir, "work"), { recursive: true })
    await writeFile(path, "v0\n")
    const b = await BufferModel.fromFile(path)
    b.setText("v1\n")
    await b.save({ backupDirectoryAlist: [[".", backupRoot]] })
    const backupPath = resolveBackupPath(path, [[".", backupRoot]])!
    expect(await readFile(backupPath, "utf8")).toBe("v0\n")
    await expect(access(path + "~")).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe("v1\n")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("save() skips backup when alist entry directory is null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-backup-nil-"))
  try {
    const path = join(dir, "f.txt")
    await writeFile(path, "orig")
    const b = await BufferModel.fromFile(path)
    b.setText("new")
    await b.save({ backupDirectoryAlist: [[".", null]] })
    await expect(access(path + "~")).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe("new")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
