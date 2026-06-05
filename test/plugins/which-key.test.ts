import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { keySeq } from "../harness/script"
import { install, bindingsUnder, describePrefix, formatWhichKey, showWhichKey } from "../../plugins/which-key"
import { setCustom } from "../../src/runtime/custom"
import type { Editor } from "../../src/kernel/editor"

let editor: Editor
let messages: string[]

beforeEach(() => {
  editor = makeEditor()
  install(editor)
  messages = []
  editor.events.on("message", ({ text }) => { messages.push(text) })
})

afterEach(() => {
  if (editor.isMinorModeEnabled("which-key-mode")) {
    editor.disableMinorMode("which-key-mode")
  }
})

async function waitFor(pred: () => boolean, timeout = 1000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (pred()) return true
    await new Promise(r => setTimeout(r, 5))
  }
  return pred()
}

const lastMsg = () => messages[messages.length - 1] ?? ""

describe("describePrefix", () => {
  test("lists next-key entries under C-x from the global map", () => {
    const entries = describePrefix(editor, "C-x")
    const map = new Map(entries)
    expect(map.get("C-s")).toBe("save-buffer")
    expect(map.get("C-f")).toBe("find-file")
    expect(map.get("b")).toBe("switch-to-buffer")
    expect(map.get("o")).toBe("other-window")
  })

  test("collapses deeper sequences to +prefix", () => {
    const entries = describePrefix(editor, "C-x")
    const map = new Map(entries)
    expect(map.get("4")).toBe("+prefix")
  })

  test("expands a nested prefix on the second keystroke", () => {
    const entries = describePrefix(editor, "C-x 4")
    const map = new Map(entries)
    expect(map.get("f")).toBe("find-file-other-window")
    expect(map.get("b")).toBe("switch-to-buffer-other-window")
  })

  test("dedupes by lookup order so a minor-mode binding shadows global", () => {
    editor.key("C-c z", "keyboard-quit")
    editor.enableMinorMode("which-key-mode")
    editor.defineKey("which-key-mode", "C-c z", "save-buffer")
    const map = new Map(describePrefix(editor, "C-c"))
    expect(map.get("z")).toBe("save-buffer")
  })

  test("bindingsUnder returns full sequences, not next-keys", () => {
    const seqs = bindingsUnder(editor, "C-h").map(([s]) => s)
    expect(seqs).toContain("C-h b")
    expect(seqs).toContain("C-h k")
    expect(seqs.every(s => s.startsWith("C-h "))).toBe(true)
  })

  test("empty for an unknown prefix", () => {
    expect(describePrefix(editor, "C-q")).toEqual([])
  })
})

describe("formatWhichKey", () => {
  test("renders prefix header and key→command pairs", () => {
    const out = formatWhichKey("C-x", [["C-f", "find-file"], ["b", "switch-to-buffer"]], " → ")
    expect(out).toBe("C-x-:  C-f → find-file  b → switch-to-buffer")
  })
})

describe("which-key-mode", () => {
  test("toggle command enables and disables the mode", async () => {
    expect(editor.isMinorModeEnabled("which-key-mode")).toBe(false)
    await editor.run("which-key-mode")
    expect(editor.isMinorModeEnabled("which-key-mode")).toBe(true)
    await editor.run("which-key-mode")
    expect(editor.isMinorModeEnabled("which-key-mode")).toBe(false)
  })

  test("shows bindings in echo area after idle delay on a prefix key", async () => {
    await editor.run("which-key-mode")
    setCustom("which-key-idle-delay", 0.02)
    await keySeq(editor, "C-x")
    expect(editor.keymaps.pendingSequence()).toBe("C-x")
    const ok = await waitFor(() => lastMsg().startsWith("C-x-:"))
    expect(ok).toBe(true)
    expect(lastMsg()).toContain("C-s → save-buffer")
    expect(lastMsg()).toContain("4 → +prefix")
  })

  test("follow-up key before the delay cancels the popup", async () => {
    await editor.run("which-key-mode")
    setCustom("which-key-idle-delay", 0.05)
    await keySeq(editor, "C-x", "o")
    const fired = await waitFor(() => messages.some(m => m.startsWith("C-x-:")), 150)
    expect(fired).toBe(false)
  })

  test("reschedules on a deeper prefix", async () => {
    await editor.run("which-key-mode")
    setCustom("which-key-idle-delay", 0.02)
    await keySeq(editor, "C-x", "4")
    expect(editor.keymaps.pendingSequence()).toBe("C-x 4")
    const ok = await waitFor(() => lastMsg().startsWith("C-x 4-:"))
    expect(ok).toBe(true)
    expect(lastMsg()).toContain("f → find-file-other-window")
  })

  test("does nothing while the mode is disabled", async () => {
    setCustom("which-key-idle-delay", 0.02)
    await keySeq(editor, "C-x")
    const fired = await waitFor(() => messages.some(m => m.startsWith("C-x-:")), 100)
    expect(fired).toBe(false)
  })

  test("respects which-key-separator", () => {
    setCustom("which-key-separator", " : ")
    editor.enableMinorMode("which-key-mode")
    showWhichKey(editor, "C-h")
    expect(lastMsg()).toContain("b : describe-bindings")
    setCustom("which-key-separator", " → ")
  })
})
