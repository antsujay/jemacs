import { expect, test } from "bun:test"

test("stdio decoder handles UTF-8 split across chunk boundary", () => {
  const decoder = new TextDecoder()
  let received = ""
  const onData = (chunk: string) => { received += chunk }
  for (const value of [new Uint8Array([0x68, 0xc3]), new Uint8Array([0xa9])]) {
    onData(decoder.decode(value, { stream: true }))
  }
  expect(received).toBe("hé")
})
