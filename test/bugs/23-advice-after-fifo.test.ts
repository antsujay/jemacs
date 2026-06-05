import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { addAdvice } from "../../src/runtime/advice"

test(":after advice runs LIFO (last added unwinds first)", async () => {
  const editor = new Editor()
  const order: string[] = []
  editor.command("after-order", () => {})
  addAdvice("after-order", { after: () => { order.push("A") } })
  addAdvice("after-order", { after: () => { order.push("B") } })
  await editor.run("after-order")
  expect(order).toEqual(["B", "A"])
})
