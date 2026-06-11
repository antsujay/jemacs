import { expect, test } from "bun:test"
import { layoutCharGrid } from "../../src/display/char-grid-layout"
import type { LogicalModel, LogicalPane } from "../../src/display/logical"
import { plainThemedText, themedTextPlain } from "../../src/display/themed-text"
import type { BufferModel } from "../../src/kernel/buffer"
import type { Theme } from "../../src/display/theme"

const theme: Theme = { name: "test", faces: {} }

function model(pane: LogicalPane): LogicalModel {
  return {
    windows: { kind: "leaf", id: "w0", pane, dedicated: false },
    childFrames: [],
    selectedWindowId: "w0",
    minibuffer: null,
    completion: null,
    overlayRows: 0,
    echo: plainThemedText(""),
    title: plainThemedText(""),
    theme,
    hostLabel: "test",
  }
}

function pane(over: Partial<LogicalPane>): LogicalPane {
  const locals = over.locals ?? new Map()
  return {
    bufferId: "b0",
    buffer: { locals } as unknown as BufferModel,
    text: "",
    displayText: "",
    spans: [],
    fontLockSpans: [],
    point: 0,
    mark: null,
    markActive: false,
    selected: false,
    startLine: 0,
    mode: "fundamental",
    modeline: plainThemedText(""),
    readOnly: false,
    showLineNumbers: false,
    textScale: 1,
    locals,
    ...over,
  }
}

function leafBody(m: ReturnType<typeof layoutCharGrid>) {
  if (m.windows.kind !== "leaf") throw new Error("expected leaf")
  return m.windows.pane.body
}

// t-audit2-df12aac9: window.startLine is a raw-text line index but the layout
// path slices/wraps/row-weights pane.displayText. When a display filter shifts
// line indices (here: prepends a header line), the raw cursorLine/startLine
// under-scroll the display text and the cursor's display line falls off-screen.
test("layoutCharGrid: startLine vs displayText line index space", () => {
  const text = "A\nB\nC"
  const prefix = "header\n"
  const displayText = prefix + text + "\nfooter"
  const dm = layoutCharGrid(model(pane({
    text,
    displayText,
    displayMap: n => n + prefix.length,
    point: text.length, // raw end-of-C; raw line 2, display line 3
    selected: true,
    startLine: 0,
  })), { rows: 6, cols: 40 }) // maxLines = windowBodyLines(contentAreaLines(6)) = 2
  const body = themedTextPlain(leafBody(dm))
  expect(body).toContain("C")
})

// t-audit2-98ebbccd (merged): padBodyLines pushed the same pad chunk object for
// every row — downstream chunk mutation would corrupt every padded row at once.
test("layoutCharGrid: visual-fill left-margin pad chunks are not aliased", () => {
  const locals = new Map<string, unknown>([
    ["markdown-visual-fill-column-mode", true],
    ["markdown-fill-column", 20],
    ["markdown-visual-fill-column-center-text", true],
  ])
  const dm = layoutCharGrid(model(pane({
    text: "aaa\nbbb\nccc",
    displayText: "aaa\nbbb\nccc",
    locals,
  })), { rows: 30, cols: 80 })
  const chunks = leafBody(dm).chunks
  const padText = chunks[0]!.text
  expect(padText.trim()).toBe("")
  const pads = chunks.filter(c => c.text === padText)
  expect(pads.length).toBeGreaterThanOrEqual(3)
  expect(pads[0]).not.toBe(pads[1])
  expect(pads[1]).not.toBe(pads[2])
})
