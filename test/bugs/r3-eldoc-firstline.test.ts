import { expect, test } from "bun:test"
import { firstLine } from "../../plugins/eldoc"

test("eldoc firstLine skips leading blank lines in hover markdown", () => {
  expect(firstLine("\n\n```rust\nfn foo() -> i32\n```")).toBe("fn foo() -> i32")
  expect(firstLine("  \n\t\nconst x: number")).toBe("const x: number")
  expect(firstLine("hello\nworld")).toBe("hello")
  expect(firstLine("   ")).toBe("")
})
