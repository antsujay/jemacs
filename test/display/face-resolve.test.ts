import { expect, test } from "bun:test"
import { applyTheme, defineTheme } from "../../src/display/theme"
import { BufferModel } from "../../src/kernel/buffer"
import {
  composeTheme,
  faceRemapAddRelative,
  resetFace,
  resolveFace,
  setFaceAttribute,
} from "../../src/runtime/faces"

test("resolveFace inherits family and height from default", () => {
  const theme = defineTheme("test", {
    default: { family: "Fira Code", height: 140, fg: "#fff", bg: "#000" },
    keyword: { fg: "#f00", bold: true },
  })
  const resolved = resolveFace("keyword", theme)
  expect(resolved?.family).toBe("Fira Code")
  expect(resolved?.height).toBe(140)
  expect(resolved?.fg).toBe("#f00")
})

test("setFaceAttribute overrides composed theme default face", () => {
  resetFace("default")
  setFaceAttribute("default", "family", "JetBrains Mono")
  const base = defineTheme("test", { default: { family: "Menlo", height: 120 } })
  const composed = composeTheme(base)
  expect(composed.faces.default?.family).toBe("JetBrains Mono")
  expect(composed.faces.default?.height).toBe(120)
  resetFace("default")
})

test("faceRemapAddRelative applies buffer-local font overrides", () => {
  const theme = defineTheme("test", {
    default: { family: "Fira Code", height: 140 },
  })
  const buffer = new BufferModel({ name: "md", mode: "markdown", text: "# Title" })
  faceRemapAddRelative(buffer, "default", { family: "Helvetica Neue", height: 200 })
  const themed = applyTheme("# Title", [{ start: 0, end: 7, face: "default" }], theme, { buffer })
  expect(themed.chunks[0]?.family).toBe("Helvetica Neue")
  expect(themed.chunks[0]?.height).toBe(200)
})

test("faceRemapAddRelative heightScale multiplies resolved height", () => {
  const theme = defineTheme("test", {
    default: { height: 100 },
  })
  const buffer = new BufferModel({ name: "md", mode: "markdown", text: "text" })
  faceRemapAddRelative(buffer, "default", { heightScale: 2 })
  const resolved = resolveFace("default", theme, buffer)
  expect(resolved?.height).toBe(200)
})

test("applyTheme carries unrenderable font attrs in chunks for hosts that support them", () => {
  const theme = defineTheme("test", {
    default: { family: "Missing Font XYZ", height: 140 },
  })
  const themed = applyTheme("x", [], theme)
  expect(themed.chunks[0]?.family).toBe("Missing Font XYZ")
  expect(themed.chunks[0]?.height).toBe(140)
})
