import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { LspManager } from "../../src/lsp/manager"
import { ensureBufferLspState } from "../../src/lsp/buffer-state"
import type { LspWorkspace } from "../../src/lsp/workspace"
import { applyTheme } from "../../src/display/theme"
import { buildDisplayModel } from "../../src/display/build-display-model"
import { themedTextPlain } from "../../src/display/themed-text"
import { gruvboxDarkHardTheme } from "../../src/themes"

// t-1f96245b: in gruvbox, the `error` face was {fg:#fb4933, bold:true} —
// byte-identical to `keyword`, so an LSP diagnostic span on an identifier
// rendered exactly like `if`/`continue`. Diagnostics now underline (no fg
// override) so they layer over the token's own font-lock colour.
test("gruvbox: error face is visually distinct from keyword face", () => {
  const kw = gruvboxDarkHardTheme.faces.keyword!
  const err = gruvboxDarkHardTheme.faces.error!
  expect(err).not.toEqual(kw)
  expect(err.underline).toBe(true)
})

test("applyTheme: a diagnostic span underlines without clobbering syntax fg", () => {
  // "if bogus" — `if` is a keyword span, `bogus` carries an error span only.
  const text = "if bogus"
  const themed = applyTheme(text, [
    { start: 0, end: 2, face: "keyword" },
    { start: 3, end: 8, face: "error" },
  ], gruvboxDarkHardTheme)
  const ifChunk = themed.chunks.find(c => c.text === "if")!
  const bogusChunk = themed.chunks.find(c => c.text === "bogus")!
  // keyword: bold red, no underline
  expect(ifChunk.underline).toBeFalsy()
  // diagnostic: underlined, and not styled identically to a keyword
  expect(bogusChunk.underline).toBe(true)
  expect({ fg: bogusChunk.fg, bold: bogusChunk.bold, underline: bogusChunk.underline })
    .not.toEqual({ fg: ifChunk.fg, bold: ifChunk.bold, underline: ifChunk.underline })
})

// t-1f96245b (secondary): the diagnostic message was only reachable via
// M-x flymake-goto-next-error. When point sits inside a diagnostic range the
// echo area should show the message eldoc-style on every redisplay.
test("echo area shows diagnostic message when point is inside its range", () => {
  const editor = new Editor()
  editor.setTheme(gruvboxDarkHardTheme)
  editor.lsp = new LspManager(editor)
  const buf = new BufferModel({
    name: "main.go",
    path: "/tmp/t-1f96245b/main.go",
    text: "package main\n\nfunc main() { bogus }\n",
    kind: "file",
    mode: "text",
  })
  editor.addBuffer(buf)
  editor.switchToBuffer(buf.id)
  // bogus is at [28,33) — line 2 (0-based), chars 14..19
  const ws = {
    diagnosticsByPath: new Map([[buf.path!, [{
      range: { start: { line: 2, character: 14 }, end: { line: 2, character: 19 } },
      severity: 1,
      message: "undefined: bogus",
    }]]]),
  } as unknown as LspWorkspace
  ensureBufferLspState(buf, "file://" + buf.path).workspaces = [ws]

  buf.point = 30 // inside `bogus`
  const inside = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24, cols: 80 } })
  expect(themedTextPlain(inside.echo)).toContain("undefined: bogus")

  buf.point = 0 // outside any diagnostic
  const outside = buildDisplayModel(editor, { lastMessage: "", viewport: { rows: 24, cols: 80 } })
  expect(themedTextPlain(outside.echo)).not.toContain("undefined: bogus")
})
