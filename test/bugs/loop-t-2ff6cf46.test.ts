import { expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeEditor } from "../plugins/helper"
import { gotoResolvedLocation } from "../../src/lsp/navigation"
import { pathToUri } from "../../src/lsp/positions"
import { findWindowLeaf } from "../../src/kernel/window"
import { pageScrollLines } from "../../src/display/viewport"

// t-2ff6cf46: xref-find-definitions left point on the last visible row instead
// of recentering, so the function body below the definition was off-screen.
test("gotoResolvedLocation recenters point in the viewport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jemacs-t-2ff6cf46-"))
  try {
    const path = join(dir, "root.go")
    await writeFile(path, Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n"))
    const editor = makeEditor()
    const targetLine = 50
    await gotoResolvedLocation(editor, {
      uri: pathToUri(path),
      range: { start: { line: targetLine, character: 0 }, end: { line: targetLine, character: 4 } },
    })
    const leaf = findWindowLeaf(editor.windowLayout, editor.selectedWindowId)!
    const budget = pageScrollLines()
    const lastVisible = leaf.startLine + budget - 1
    // Point should be centered, leaving roughly half the page visible below.
    expect(leaf.startLine).toBe(Math.max(0, targetLine - Math.floor(budget / 2)))
    expect(lastVisible - targetLine).toBeGreaterThan(1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
