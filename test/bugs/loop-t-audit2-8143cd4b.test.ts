import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileCas, casPath, sha256 } from "../../src/shadow/cas"

let home: string
let homeSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "jemacs-cas-atomic-"))
  homeSpy = spyOn(os, "homedir").mockReturnValue(home)
})
afterEach(() => {
  homeSpy.mockRestore()
  rmSync(home, { recursive: true, force: true })
})

// t-audit2-8143cd4b: FileCas.write wrote straight to cas/<sha>; a crash mid-
// writeFileSync left a truncated blob keyed by the *full* content's hash, so
// the next lookup(sha) returned corrupt text and broke the CAS invariant.
// Fix: write to a tmp sibling then rename(2) — crash leaves either nothing or
// the complete blob, never a partial at the content-hash key.
test("FileCas.write: crash mid-write never leaves a truncated cas/<sha>", () => {
  const cas = new FileCas()
  const text = "the quick brown fox jumps over the lazy dog"
  const sha = sha256(text)

  // Simulate the crash: the OS flushed a prefix, then the process died.
  const real = fs.writeFileSync
  const spy = spyOn(fs, "writeFileSync").mockImplementation((p, data, opts) => {
    real(p, String(data).slice(0, 5), opts as never)
    throw new Error("simulated crash mid-write")
  })
  try {
    expect(() => cas.write(text)).toThrow("simulated crash mid-write")
  } finally {
    spy.mockRestore()
  }

  // CAS invariant: nothing at the content-hash key unless it hashes to that key.
  expect(fs.existsSync(casPath(sha))).toBe(false)
  expect(cas.lookup(sha)).toBeUndefined()

  // And a retry after the crash succeeds cleanly.
  expect(cas.write(text)).toBe(sha)
  expect(cas.lookup(sha)).toBe(text)
})

test("FileCas.write: completed write round-trips", () => {
  const cas = new FileCas()
  const sha = cas.write("hello world")
  expect(sha).toBe(sha256("hello world"))
  expect(cas.lookup(sha)).toBe("hello world")
})
