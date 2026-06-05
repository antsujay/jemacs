import { expect, test } from "bun:test"
import { script, spans } from "../harness"

test("typescript: every 'export' token gets keyword face", async () => {
  const src = "export const a = 1\nexport type B = number\nexport function c() {}\n"
  const ed = await script().text(src).mode("typescript").done()
  const kw = spans(ed)
    .filter(s => s.face === "keyword" && src.slice(s.start, s.end) === "export")
    .map(s => s.start)
  expect(kw).toEqual([0, 19, 42])
})
