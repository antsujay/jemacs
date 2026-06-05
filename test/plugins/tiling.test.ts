import { describe, expect, test } from "bun:test"
import { script } from "../harness"
import { tilingLayout } from "../../plugins/tiling"

describe("tiling", () => {
  test("kernel has no tiling state", async () => {
    const e = await script({ plugins: false }).done()
    expect((e as Record<string, unknown>).tilingLayout).toBeUndefined()
    expect((e as Record<string, unknown>).cycleTilingLayout).toBeUndefined()
  })

  test("plugin defines tiling-cycle on C-\\ and cycles via defvar", async () => {
    const e = await script().done()
    expect(e.keymaps.describe("C-\\")?.command).toBe("tiling-cycle")
    expect(tilingLayout()).toBe("tiling-master-left")
    await e.run("tiling-cycle")
    expect(tilingLayout()).toBe("tiling-master-top")
  })
})
