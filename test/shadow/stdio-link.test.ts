import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { attachAuthority, attachShadow, shadowState } from "../../src/shadow/shadow"
import { StdioLink, parseConnectTarget, spawnStdioLink } from "../../src/shadow/stdio-link"
import type { ShadowOp } from "../../src/shadow/ops"

const EMPTY_CONFIG = `${import.meta.dir}/../fixtures/empty-config.ts`

async function until(pred: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("until: timed out")
    await new Promise(r => setTimeout(r, 10))
  }
}

describe("StdioLink framing", () => {
  test("round-trips ShadowOps over a PassThrough pair", async () => {
    const ab = new PassThrough()
    const ba = new PassThrough()
    const a = new StdioLink(ba, ab, { role: "authority", peerId: "B" })
    const b = new StdioLink(ab, ba, { role: "shadow", peerId: "A" })

    const got: ShadowOp[] = []
    b.on(op => got.push(op))
    a.send({ kind: "ack", upTo: 7 })
    a.send({ kind: "splice", bufferId: "x", from: 0, to: 0, text: "héllo 🌍", seq: 1 })

    await until(() => got.length === 2)
    expect(got[0]).toEqual({ kind: "ack", upTo: 7 })
    expect(got[1]).toEqual({ kind: "splice", bufferId: "x", from: 0, to: 0, text: "héllo 🌍", seq: 1 })
    a.close(); b.close()
  })

  test("buffers ops that arrive before on() and flushes them", async () => {
    const pt = new PassThrough()
    const sink = new StdioLink(pt, new PassThrough(), { role: "shadow" })
    const src = new StdioLink(new PassThrough(), pt, { role: "authority" })
    src.send({ kind: "ack", upTo: 1 })
    await new Promise(r => setTimeout(r, 5))
    const got: ShadowOp[] = []
    sink.on(op => got.push(op))
    expect(got).toEqual([{ kind: "ack", upTo: 1 }])
    sink.close(); src.close()
  })

  test("in-process A↔S over PassThrough converges", async () => {
    const sToA = new PassThrough()
    const aToS = new PassThrough()
    const aLink = new StdioLink(sToA, aToS, { role: "authority", peerId: "S" })
    const sLink = new StdioLink(aToS, sToA, { role: "shadow", peerId: "A" })

    const A = new Editor()
    const S = new Editor()
    const bufA = A.addBuffer(new BufferModel({ id: "buf-1", name: "t", text: "" }))
    const bufS = S.addBuffer(new BufferModel({ id: "buf-1", name: "t", text: "" }))
    attachAuthority(A, aLink)
    attachShadow(S, sLink)

    bufS.insert("hello")
    bufS.insert(" world")

    await until(() => bufA.text === "hello world")
    await until(() => (shadowState(S)!.pending.get("buf-1") ?? []).length === 0)
    expect(bufS.text).toBe(bufA.text)
    aLink.close(); sLink.close()
  })
})

describe("parseConnectTarget", () => {
  test("stdio:CMD splits argv", () => {
    expect(parseConnectTarget("stdio:bun run src/main.ts --serve-stdio"))
      .toEqual(["bun", "run", "src/main.ts", "--serve-stdio"])
  })
  test("ssh://host builds remote argv with -- separator", () => {
    const argv = parseConnectTarget("ssh://user@box")
    expect(argv.slice(0, 3)).toEqual(["ssh", "--", "user@box"])
    expect(argv.at(-1)).toBe("--serve-stdio")
  })
  test("ssh://host/path ignores path component for now", () => {
    expect(parseConnectTarget("ssh://box/home/u/proj")[2]).toBe("box")
  })
  test("rejects unknown scheme", () => {
    expect(() => parseConnectTarget("ws://x")).toThrow(/unsupported/)
  })
  test("rejects host that could be an ssh option", () => {
    expect(() => parseConnectTarget("ssh://-oProxyCommand=evil")).toThrow(/invalid host/)
    expect(() => parseConnectTarget("ssh://box; rm -rf")).toThrow(/invalid host/)
  })
})

// Real subprocess, real pipe. Not tmux-dependent so it isn't gated on JEMACS_SKIP_TUI.
describe("spawnStdioLink ↔ jemacs --serve-stdio", () => {
  test("S types into A's announced buffer; ack drains pending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jemacs-stdio-"))
    const file = join(dir, "scratch.txt")
    writeFileSync(file, "")

    const link = spawnStdioLink([
      "bun", "run", "src/main.ts", "--serve-stdio", "--config", EMPTY_CONFIG, file,
    ])
    try {
      const S = new Editor()
      attachShadow(S, link)

      // A announces its buffers on connect (main.ts); wait for the file buffer.
      await until(() => [...S.buffers.values()].some(b => b.path === file), 20_000)
      const bufS = [...S.buffers.values()].find(b => b.path === file)!
      expect(bufS.link).toBe(link)

      bufS.insert("hello over stdio")

      // Convergence: A applied the splice and ack'd; S's optimistic state is now confirmed.
      await until(() => (shadowState(S)!.pending.get(bufS.id) ?? []).length === 0, 5_000)
      expect(bufS.text).toBe("hello over stdio")
    } finally {
      link.close()
    }
  }, 30_000)
})
