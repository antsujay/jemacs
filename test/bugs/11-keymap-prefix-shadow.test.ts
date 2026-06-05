import { test, expect } from "bun:test"
import { script, parseKey } from "../harness"

test("global C-c exact does not shadow higher-priority mode C-c C-c prefix", async () => {
  await script({ plugins: false })
    .do(ed => {
      ed.command("cmd-a", () => {})
      ed.command("cmd-b", () => {})
      ed.defineKey("global", "C-c", "cmd-a")
      ed.defineKey("text", "C-c C-c", "cmd-b")
    })
    .mode("text")
    .expect.that(async ed => {
      const r = await ed.handleKey(parseKey("C-c"))
      expect(r.status).toBe("pending")
    })
    .done()
})
