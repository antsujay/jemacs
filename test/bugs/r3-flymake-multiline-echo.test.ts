import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { install } from "../../plugins/flymake-nav"
import { BufferModel } from "../../src/kernel/buffer"
import { LspManager } from "../../src/lsp/manager"
import type { LspWorkspace } from "../../src/lsp/workspace"

test("M-n echoes first non-empty non-fence line of multi-line diagnostic", async () => {
  const editor = makeEditor()
  install(editor)
  const buffer = new BufferModel({ name: "a.rs", path: "/tmp/a.rs", text: "fn main() {}\n", kind: "file", mode: "rust" })
  editor.addBuffer(buffer)
  editor.switchToBuffer(buffer.id)

  const raMessage = "\n```text\nmismatched types\nexpected `i32`, found `String`\n```"
  const ws = {
    diagnosticsByPath: new Map([[buffer.path!, [{
      range: { start: { line: 0, character: 3 }, end: { line: 0, character: 7 } },
      message: raMessage,
      severity: 1,
      source: "rust-analyzer",
    }]]]),
  } as unknown as LspWorkspace
  const lsp = new LspManager(editor)
  lsp.bufferWorkspaces = () => [ws]
  editor.lsp = lsp

  const messages: string[] = []
  editor.events.on("message", ({ text }) => { messages.push(text) })

  buffer.point = 0
  await editor.run("flymake-goto-next-error")
  expect(messages.at(-1)).toBe("rust-analyzer [error]: mismatched types")
})
