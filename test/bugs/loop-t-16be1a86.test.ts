import { expect, test } from "bun:test"
import { buildDisplayModel } from "../../src/display/build-display-model"
import { themedTextPlain } from "../../src/display/themed-text"
import type { WindowDisplayNode } from "../../src/display/protocol"
import { makeEditor } from "../plugins/helper"

// t-16be1a86: after C-x 3 a buffer line longer than the pane width wraps in the
// host, and the continuation row draws at column 0 — flush against where the
// next line's gutter ('6  ') paints. The display model owns the gutter, so it
// must also own the wrap: continuation rows get gutter-width left padding.

function paneBodies(node: WindowDisplayNode): string[] {
  return node.kind === "leaf"
    ? [themedTextPlain(node.pane.body)]
    : [...paneBodies(node.first), ...paneBodies(node.second)]
}

test("t-16be1a86: wrapped continuation rows carry gutter-width left padding", () => {
  const editor = makeEditor()
  editor.enableMinorMode("linum-mode")
  // line 5 is the 64-char comment from examples/go-cli/task/filter.go
  const buf = editor.scratch("filter.go", [
    "package task",
    "",
    'import "strings"',
    "",
    '// Filter narrows a task slice. Zero values mean "no constraint".',
    "type Filter struct {",
    "\tTag string",
    "}",
  ].join("\n"), "go")
  buf.kind = "file"
  expect(editor.showLineNumbers(buf)).toBe(true)

  editor.splitWindowRight()
  // 100-col frame ⇒ ~50 cols per side; gutter '5  ' + 64 chars = 67 > 50.
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24, cols: 100 } })
  expect(model.windows.kind).toBe("split")

  for (const body of paneBodies(model.windows)) {
    const rows = body.split("\n")
    const gutter = rows[0]!.match(/^\s*\d+\s+/)![0].length
    // Every body row is either a real line (digit gutter) or a continuation
    // (gutter-width blank prefix). Nothing renders at column 0.
    for (const row of rows) {
      expect(row.slice(0, gutter)).toMatch(/^(\s*\d+\s+|\s+)$/)
    }
    // The wrapped tail of line 5 landed on its own row, padded — not glued to
    // line 5's gutter row and not at col 0.
    const tail = rows.find(r => r.includes('constraint".'))!
    expect(tail).toMatch(/^\s+\S/)
    expect(tail).not.toMatch(/^\s*\d/)
    // And no row blew past the pane width (host wrap would re-introduce the bug).
    expect(Math.max(...rows.map(r => r.length))).toBeLessThanOrEqual(50)
  }
})

test("t-16be1a86: single window without cols leaves body unwrapped", () => {
  const editor = makeEditor()
  editor.enableMinorMode("linum-mode")
  const buf = editor.scratch("long.txt", "x".repeat(200) + "\nshort\n", "text")
  buf.kind = "file"
  const model = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24 } })
  const body = paneBodies(model.windows)[0]!
  // No cols ⇒ no wrap; row 0 still carries the full 200-char line after the gutter.
  expect(body.split("\n")[0]!.length).toBeGreaterThan(200)
})
