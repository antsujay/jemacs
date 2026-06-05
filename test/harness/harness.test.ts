import { describe, expect, test } from "bun:test"
import { script, parseKey, keySeq, displayRows, fakeLspServer } from "."
import { serializeMessage } from "../../src/lsp/transport"

describe("harness/script", () => {
  test("fluent text/point/keys/expect", async () => {
    await script({ plugins: false })
      .text("  hello\nworld")
      .point(0)
      .keys("C-e")
      .expect.point(7)
      .keys("C-a")
      .expect.point(0)
      .done()
  })

  test("parseKey roundtrips modifiers", () => {
    expect(parseKey("C-x")).toMatchObject({ name: "x", ctrl: true })
    expect(parseKey("M-m")).toMatchObject({ name: "m", meta: true })
    expect(parseKey("C-M-s")).toMatchObject({ name: "s", ctrl: true, meta: true })
    expect(parseKey("RET")).toMatchObject({ name: "return" })
    expect(parseKey("a")).toMatchObject({ name: "a", sequence: "a" })
  })

  test("keySeq goes through real handleKey (not editor.run)", async () => {
    const e = await script({ plugins: false }).text("").done()
    await keySeq(e, "h", "i")
    expect(e.currentBuffer.text).toBe("hi")
  })
})

describe("harness/display", () => {
  test("displayRows flattens body to plain text", async () => {
    const e = await script({ plugins: false }).text("alpha\nbeta\ngamma").point(0).done()
    const rows = displayRows(e)
    expect(rows.join("\n")).toContain("beta")
  })
})

describe("harness/fake-lsp", () => {
  test("captures sent messages and delivers responses", () => {
    const server = fakeLspServer()
    let received: unknown = null
    const handle = server.connection.connect({
      onData: chunk => { received = chunk },
      onExit: () => {},
      serverId: "fake",
      cwd: "/",
    })
    handle.send(serializeMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }))
    expect(server.sent.length).toBe(1)
    expect(server.sent[0].method).toBe("initialize")
    server.respond(1, { capabilities: {} })
    expect(typeof received).toBe("string")
  })
})
