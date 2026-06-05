import { test, expect } from "bun:test"
import { LspMessageParser, serializeMessage } from "../../src/lsp/transport"

test("LspMessageParser treats Content-Length as bytes, not UTF-16 code units", () => {
  const a = serializeMessage({ jsonrpc: "2.0", method: "a", params: "日本語" })
  const b = serializeMessage({ jsonrpc: "2.0", method: "b", params: "ok" })
  const out = new LspMessageParser().feed(a + b)
  expect(out).toHaveLength(2)
  expect(out[0]?.params).toBe("日本語")
  expect(out[1]?.params).toBe("ok")
})
