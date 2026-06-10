import { expect, test } from "bun:test"
import { buildDisplayModel } from "../../src/display/build-display-model"
import type { TransientDefinition } from "../../src/kernel/editor"
import { makeEditor } from "./helper"

const demoTransient: TransientDefinition = {
  name: "demo",
  title: "Demo Popup",
  groups: [
    {
      title: "Arguments",
      infixes: [
        { key: "- x", label: "extra", argument: "--extra" },
      ],
    },
    {
      title: "Actions",
      suffixes: [
        { key: "a", label: "act", command: "demo-act" },
      ],
    },
  ],
}

test("transient opens, renders, toggles infixes, and dispatches suffix args", async () => {
  const editor = makeEditor()
  let seen: string[] = []
  editor.command("demo-act", ({ args }) => { seen = args })

  editor.openTransient(demoTransient)
  expect(editor.minibufferCompletionDisplay?.text).toContain("Demo Popup")
  expect(editor.minibufferCompletionDisplay?.text).toContain("[ ] extra")

  expect((await editor.handleKey({ name: "-", sequence: "-" })).status).toBe("pending")
  expect((await editor.handleKey({ name: "x", sequence: "x" })).status).toBe("command")
  expect(editor.minibufferCompletionDisplay?.text).toContain("[*] extra")

  const result = await editor.handleKey({ name: "a", sequence: "a" })
  expect(result.status).toBe("command")
  expect(result.status === "command" && result.command).toBe("demo-act")
  expect(seen).toEqual(["--extra"])
  expect(editor.transient).toBeNull()
  expect(editor.minibufferCompletionDisplay).toBeNull()
})

test("transient cancellation clears popup without running a suffix", async () => {
  const editor = makeEditor()
  let ran = false
  editor.command("demo-act", () => { ran = true })

  editor.openTransient(demoTransient)
  const result = await editor.handleKey({ name: "g", ctrl: true })
  expect(result.status).toBe("command")
  expect(editor.transient).toBeNull()
  expect(editor.minibufferCompletionDisplay).toBeNull()
  expect(ran).toBe(false)
})

test("unknown transient key reports a message and keeps the popup active", async () => {
  const editor = makeEditor()
  let message = ""
  editor.events.on("message", ({ text }) => { message = text })

  editor.openTransient(demoTransient)
  const result = await editor.handleKey({ name: "z", sequence: "z" })

  expect(result.status).toBe("unmatched")
  expect(message).toContain("No transient binding: z")
  expect(editor.transient?.definition.name).toBe("demo")
  expect(editor.minibufferCompletionDisplay?.text).toContain("Demo Popup")
})

test("display model allocates bottom rows for transient popup", () => {
  const editor = makeEditor()
  editor.openTransient(demoTransient)

  const model = buildDisplayModel(editor, {
    viewport: { rows: 12, cols: 80 },
  })

  expect(model.minibufferCompletionLines).toBeGreaterThan(1)
  expect(model.minibufferCompletions.chunks.map(c => c.text).join("")).toContain("Demo Popup")
  expect(model.minibuffer.chunks.map(c => c.text).join("")).toBe(" ")
})
