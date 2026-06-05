import { describe, expect, test } from "bun:test"
import { tuiProbe } from "../harness/tui"

// Layer-3 regression suite — the things unit tests can't catch (key encoding,
// echo-area, real LSP). Each test is a scenario I'd run by hand. Slow (~1s ea).

describe("tui/dogfood", () => {
  test("M-> lands at end-of-buffer through the real terminal", async () => {
    const { screen } = await tuiProbe({ file: "examples/docs/guide.md", keys: ["M->"] })
    expect(screen).toMatch(/line 16/)
    expect(screen).not.toMatch(/Unbound key/)
  })

  test("C-SPC C-n C-n highlights region (no stale echo)", async () => {
    const { screen } = await tuiProbe({
      file: "examples/docs/guide.md",
      keys: ["C-Space", "C-n", "C-n"],
    })
    // capansi would show the bg span; plain-text proxy: modeline reflects line 3
    expect(screen).toMatch(/line 3/)
    expect(screen).not.toMatch(/Unbound key/)
  })

  test.todo("C-s search then Enter exits and clears echo", async () => {
    const { screen, echo } = await tuiProbe({
      file: "src/kernel/buffer.ts",
      keys: ["C-s", "moveLine", "Enter", "C-l"],
    })
    expect(screen).toMatch(/moveLine/)
    expect(echo).not.toMatch(/I-search/)
  })

  test("paste burst inserts each char (C1 regression)", async () => {
    const { screen } = await tuiProbe({ keys: ["a", "b", "c", "X", "Y", "Z"] })
    expect(screen).toMatch(/abcXYZ/)
    expect(screen).not.toMatch(/ZZZZZZ/)
  })

  test.todo("C-x C-z opens project-find-file with fido candidates", async () => {
    const { screen } = await tuiProbe({
      file: "examples/docs/guide.md",
      keys: ["C-x", "C-z"],
      waitFor: "Project file",
    })
    expect(screen).toMatch(/README\.md|AGENTS\.md/)
  })

  test.todo("M-x term spawns a shell and echoes pwd", async () => {
    const { screen } = await tuiProbe({
      keys: ["M-x", "term", "Enter"],
      waitFor: "\\$",
    })
    expect(screen).toMatch(/\*term\*/)
  })
})
