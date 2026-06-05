import { afterEach, expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { defineMode } from "../../src/modes/mode"
import { BufferModel } from "../../src/kernel/buffer"
import { xrefPushMark, xrefGoBack } from "../../src/xref/history"
import { cancelTimer, type Timer } from "../../plugins/persist"
import {
  type EldocFunction,
  eldocPrintCurrentSymbolInfo,
  eldocScheduleTimer,
  install,
} from "../../plugins/eldoc"

let timers: Timer[] = []
afterEach(() => {
  for (const t of timers) cancelTimer(t)
  timers = []
})

// t-8d4811ae: ELDOC_LAST_MESSAGE is buffer-local but the echo area is
// editor-global. After M-. shows root.go's signature and M-, returns to
// main.go, main.go's buffer-local `last` still matches its own doc from
// before the jump, so eldoc dedups and never overwrites root.go's stale
// message in the echo area.
test("eldoc re-displays after xref-go-back to a previously-shown buffer", async () => {
  const mainDoc: EldocFunction = () => "package main"
  const rootDoc: EldocFunction = () => "func (r *Root) Execute(ctx context.Context) error"
  defineMode({ name: "go-main-t8d4811ae", eldocFunction: mainDoc } as Parameters<typeof defineMode>[0])
  defineMode({ name: "go-root-t8d4811ae", eldocFunction: rootDoc } as Parameters<typeof defineMode>[0])

  const editor = makeEditor()
  install(editor)
  timers.push(eldocScheduleTimer(editor))

  const main = new BufferModel({ name: "main.go", text: "r.Execute(ctx)\n", mode: "go-main-t8d4811ae" })
  const root = new BufferModel({ name: "root.go", text: "func (r *Root) Execute() {}\n", mode: "go-root-t8d4811ae" })
  editor.addBuffer(main)
  editor.addBuffer(root)

  let echo = ""
  editor.events.on("message", e => { echo = e.text })

  // Before M-.: eldoc has already fired in main.go.
  editor.switchToBuffer(main.id)
  await eldocPrintCurrentSymbolInfo(editor)
  expect(echo).toBe("package main")

  // M-. jumps to root.go; eldoc shows Execute's signature.
  xrefPushMark(editor, main)
  editor.switchToBuffer(root.id)
  await eldocPrintCurrentSymbolInfo(editor)
  expect(echo).toBe("func (r *Root) Execute(ctx context.Context) error")

  // M-, returns to main.go.
  expect(xrefGoBack(editor)).toBe(true)
  expect(editor.currentBuffer.id).toBe(main.id)
  await eldocPrintCurrentSymbolInfo(editor)

  // Echo area must reflect main.go again, not root.go's stale signature.
  expect(echo).toBe("package main")
})

test("eldoc clears the echo area after switching to a buffer with no doc", async () => {
  const rootDoc: EldocFunction = () => "func (r *Root) Execute(ctx context.Context) error"
  defineMode({ name: "go-root2-t8d4811ae", eldocFunction: rootDoc } as Parameters<typeof defineMode>[0])

  const editor = makeEditor()
  install(editor)
  timers.push(eldocScheduleTimer(editor))

  const main = new BufferModel({ name: "main.go", text: "\n" }) // no eldocFunction, no LSP
  const root = new BufferModel({ name: "root.go", text: "x\n", mode: "go-root2-t8d4811ae" })
  editor.addBuffer(main)
  editor.addBuffer(root)

  let echo = ""
  editor.events.on("message", e => { echo = e.text })

  editor.switchToBuffer(root.id)
  await eldocPrintCurrentSymbolInfo(editor)
  expect(echo).toBe("func (r *Root) Execute(ctx context.Context) error")

  editor.switchToBuffer(main.id)
  await eldocPrintCurrentSymbolInfo(editor)
  // Nothing to show in main.go → eldoc must clear what it put there, not
  // leave root.go's signature on screen.
  expect(echo).not.toBe("func (r *Root) Execute(ctx context.Context) error")
})
