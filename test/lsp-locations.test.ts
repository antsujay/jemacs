import { expect, test } from "bun:test"
import { formatLocation, normalizeLocations } from "../src/lsp/locations"

test("normalizeLocations handles Location and LocationLink", () => {
  const loc = normalizeLocations({
    uri: "file:///foo.ts",
    range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
  })
  expect(loc).toHaveLength(1)
  expect(loc[0]?.uri).toBe("file:///foo.ts")

  const links = normalizeLocations([{
    targetUri: "file:///bar.ts",
    targetRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
    targetSelectionRange: { start: { line: 2, character: 3 }, end: { line: 2, character: 4 } },
  }])
  expect(links[0]?.range.start.line).toBe(2)
  expect(links[0]?.range.start.character).toBe(3)
})

test("formatLocation uses 1-based lines", () => {
  expect(formatLocation("/x.ts", { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } })).toBe("/x.ts:1:1")
})
