import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test"
import { makeEditor } from "./helper"
import { install, osc52Encode } from "../../plugins/osc52"
import { clearAdvice } from "../../src/runtime/advice"
import { setCustom } from "../../src/runtime/custom"

const ADVISED = ["kill-region", "kill-line", "kill-word", "backward-kill-word", "kill-ring-save"]

describe("osc52", () => {
  let writeSpy: Mock<typeof process.stdout.write>
  let savedIsTTY: boolean | undefined

  beforeEach(() => {
    for (const name of ADVISED) clearAdvice(name)
    savedIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    setCustom("osc52-enabled", true)
  })

  afterEach(() => {
    writeSpy.mockRestore()
    Object.defineProperty(process.stdout, "isTTY", { value: savedIsTTY, configurable: true })
  })

  const lastWrite = () => writeSpy.mock.calls.at(-1)?.[0] as string

  test("osc52Encode wraps base64 payload in ESC]52;c;...BEL", () => {
    expect(osc52Encode("hello")).toBe("\x1b]52;c;aGVsbG8=\x07")
    expect(osc52Encode("")).toBe("\x1b]52;c;\x07")
  })

  test("kill-region emits the killed region", async () => {
    const editor = makeEditor()
    install(editor)
    const buf = editor.currentBuffer
    buf.setText("foo bar baz", false)
    buf.point = 4
    buf.setMark()
    buf.point = 7

    await editor.run("kill-region")

    expect(buf.text).toBe("foo  baz")
    expect(lastWrite()).toBe(osc52Encode("bar"))
  })

  test("kill-line emits text from point to end of line", async () => {
    const editor = makeEditor()
    install(editor)
    const buf = editor.currentBuffer
    buf.setText("first\nsecond\n", false)
    buf.point = 2

    await editor.run("kill-line")

    expect(buf.text).toBe("fi\nsecond\n")
    expect(lastWrite()).toBe(osc52Encode("rst"))
  })

  test("kill-word and backward-kill-word emit the deleted word", async () => {
    const editor = makeEditor()
    install(editor)
    const buf = editor.currentBuffer
    buf.setText("alpha beta gamma", false)
    buf.point = 6

    await editor.run("kill-word")
    expect(lastWrite()).toBe(osc52Encode("beta"))

    buf.setText("alpha beta gamma", false)
    buf.point = 10
    await editor.run("backward-kill-word")
    expect(lastWrite()).toBe(osc52Encode("beta"))
  })

  test("kill-ring-save emits the selection without mutating the buffer", async () => {
    const editor = makeEditor()
    install(editor)
    const buf = editor.currentBuffer
    buf.setText("one two three", false)
    buf.point = 4
    buf.setMark()
    buf.point = 7

    await editor.run("kill-ring-save")

    expect(buf.text).toBe("one two three")
    expect(lastWrite()).toBe(osc52Encode("two"))
  })

  test("does nothing when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    const editor = makeEditor()
    install(editor)
    const buf = editor.currentBuffer
    buf.setText("text", false)
    buf.point = 0

    await editor.run("kill-line")

    expect(writeSpy).not.toHaveBeenCalled()
  })

  test("does nothing when osc52-enabled is false", async () => {
    setCustom("osc52-enabled", false)
    const editor = makeEditor()
    install(editor)
    const buf = editor.currentBuffer
    buf.setText("text", false)
    buf.point = 0

    await editor.run("kill-line")

    expect(writeSpy).not.toHaveBeenCalled()
  })

  test("empty kill (point at end of buffer) emits nothing", async () => {
    const editor = makeEditor()
    install(editor)
    const buf = editor.currentBuffer
    buf.setText("abc", false)
    buf.point = 3

    await editor.run("kill-line")

    expect(writeSpy).not.toHaveBeenCalled()
  })
})
