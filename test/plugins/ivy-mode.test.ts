import { describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { install } from "../../plugins/ivy-mode"

// ivyCompletingRead awaits an internal refresh before blocking on the prompt;
// yield once so *ivy-completions* is populated before we assert on it.
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

const ivyBuffer = (editor: ReturnType<typeof makeEditor>) =>
  [...editor.buffers.values()].find(b => b.name === "*ivy-completions*")

async function openIvy(collection: string[]) {
  const editor = makeEditor()
  install(editor)
  editor.enableMinorMode("ivy-mode")
  const result = editor.completingRead("Pick: ", { collection })
  await tick()
  return { editor, result }
}

describe("ivy-mode minor mode", () => {
  test("enabling sets completingReadFunction; disabling restores the previous one", () => {
    const editor = makeEditor()
    install(editor)
    const before = editor.completingReadFunction
    expect(editor.globalMinorModes.has("ivy-mode")).toBe(false)

    editor.enableMinorMode("ivy-mode")
    expect(editor.globalMinorModes.has("ivy-mode")).toBe(true)
    expect(editor.completingReadFunction).not.toBe(before)
    expect(editor.completingReadFunction).not.toBeNull()

    editor.disableMinorMode("ivy-mode")
    expect(editor.globalMinorModes.has("ivy-mode")).toBe(false)
    expect(editor.completingReadFunction).toBe(before)
  })

  test("ivy-mode command toggles the mode", async () => {
    const editor = makeEditor()
    install(editor)
    await editor.run("ivy-mode")
    expect(editor.globalMinorModes.has("ivy-mode")).toBe(true)
    await editor.run("ivy-mode")
    expect(editor.globalMinorModes.has("ivy-mode")).toBe(false)
  })
})

describe("ivy completion frontend", () => {
  test("opening a collection prompt populates *ivy-completions* with the first candidate selected", async () => {
    const { editor, result } = await openIvy(["alpha", "beta", "gamma"])
    const buf = ivyBuffer(editor)
    expect(buf).toBeDefined()
    expect(buf?.text).toBe("> alpha\n  beta\n  gamma")
    editor.minibufferCancel()
    await expect(result).resolves.toBeNull()
  })

  test("typing filters candidates by case-insensitive substring", async () => {
    const { editor, result } = await openIvy(["find-file", "Forward-Char", "list-buffers"])
    await editor.handleKey({ name: "f", sequence: "f" })
    await editor.handleKey({ name: "o", sequence: "o" })
    expect(editor.activeBuffer.text).toBe("fo")
    expect(ivyBuffer(editor)?.text).toBe("> Forward-Char")
    editor.minibufferCancel()
    await expect(result).resolves.toBeNull()
  })

  test("ivy-next-line / ivy-previous-line move the selection marker and wrap", async () => {
    const { editor, result } = await openIvy(["alpha", "beta", "gamma"])
    expect(ivyBuffer(editor)?.text).toContain("> alpha")

    await editor.run("ivy-next-line")
    expect(ivyBuffer(editor)?.text).toBe("  alpha\n> beta\n  gamma")

    await editor.run("ivy-next-line")
    expect(ivyBuffer(editor)?.text).toContain("> gamma")

    await editor.run("ivy-next-line")
    expect(ivyBuffer(editor)?.text).toContain("> alpha")

    await editor.run("ivy-previous-line")
    expect(ivyBuffer(editor)?.text).toContain("> gamma")

    editor.minibufferCancel()
    await expect(result).resolves.toBeNull()
  })

  test("C-n / C-p keybindings drive ivy-next-line / ivy-previous-line", async () => {
    const { editor, result } = await openIvy(["alpha", "beta", "gamma"])
    await editor.handleKey({ name: "n", ctrl: true })
    expect(ivyBuffer(editor)?.text).toContain("> beta")
    await editor.handleKey({ name: "p", ctrl: true })
    expect(ivyBuffer(editor)?.text).toContain("> alpha")
    editor.minibufferCancel()
    await expect(result).resolves.toBeNull()
  })

  test("submit returns the selected candidate, not the typed input", async () => {
    const { editor, result } = await openIvy(["alpha", "beta", "gamma"])
    await editor.run("ivy-next-line")
    editor.minibufferSubmit()
    await expect(result).resolves.toBe("beta")
    expect(editor.minibuffer).toBeNull()
  })

  test("minibufferComplete (TAB) inserts the selected candidate into the minibuffer text", async () => {
    const { editor, result } = await openIvy(["alpha", "alphabet"])
    expect(editor.activeBuffer.text).toBe("")
    await editor.minibufferComplete()
    expect(editor.activeBuffer.text).toBe("alpha")
    expect(editor.activeBuffer.point).toBe("alpha".length)
    editor.minibufferCancel()
    await expect(result).resolves.toBeNull()
  })

  test("minibufferCompletionFrontend is restored after the prompt resolves", async () => {
    const editor = makeEditor()
    install(editor)
    editor.enableMinorMode("ivy-mode")
    const before = editor.minibufferCompletionFrontend
    const result = editor.completingRead("Pick: ", { collection: ["x"] })
    await tick()
    expect(editor.minibufferCompletionFrontend).not.toBe(before)
    editor.minibufferSubmit()
    await result
    await tick()
    expect(editor.minibufferCompletionFrontend).toBe(before)
  })
})
