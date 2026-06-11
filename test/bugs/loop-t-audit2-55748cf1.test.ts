import { expect, test } from "bun:test"
import { Coalescer, LinkClosed } from "../../src/shadow/link"

/** Settle `p` to its rejection (or "resolved"/"HUNG") so the assertion proves
 *  non-hang and bun never sees an unhandled rejection between close() and await. */
const outcome = (p: Promise<unknown>) =>
  Promise.race([
    p.then(() => "resolved" as const, e => e as unknown),
    new Promise(r => setTimeout(() => r("HUNG"), 50)),
  ])

// t-audit2-55748cf1: remote-runtime's hand-rolled dirWaiters/wantWaiters held
// only `resolve` callbacks. On link.close() nothing rejected them, so any
// in-flight readFileText/stat/readdir hung forever. Coalescer is the extracted
// primitive — close() must reject every pending waiter with LinkClosed, and
// further request()s must reject immediately rather than enqueue on a dead link.
test("Coalescer.close() rejects pending waiters with LinkClosed (no hang)", async () => {
  const c = new Coalescer<string>()
  let sends = 0
  const o1 = outcome(c.request("/src/a.ts", () => { sends++ }))
  const o2 = outcome(c.request("/src/a.ts", () => { sends++ })) // coalesced — no second send
  expect(sends).toBe(1)

  c.close(new LinkClosed("A"))

  expect(await o1).toBeInstanceOf(LinkClosed)
  expect(await o2).toBeInstanceOf(LinkClosed)

  // Latched: requests after close don't enqueue.
  const o3 = outcome(c.request("/src/b.ts"))
  expect(c.has("/src/b.ts")).toBe(false)
  expect(await o3).toBeInstanceOf(LinkClosed)
})

// t-audit2-ee5c77d8 (merged): A→S Chunk stream has no seq/ack, so one dropped
// chunk leaves a gap the reassembler waits on forever. Coalescer.resend() is
// the retransmit hook — re-fire the original Want for a still-pending key so A
// re-streams (chunk application is idempotent on offset).
test("Coalescer.resend() re-fires the original send for a pending key", () => {
  const c = new Coalescer<string>()
  let wants = 0
  void c.request("buf-1", () => { wants++ })
  expect(wants).toBe(1)

  expect(c.resend("buf-1")).toBe(true)
  expect(wants).toBe(2)

  c.resolve("buf-1", "text")
  expect(c.resend("buf-1")).toBe(false) // settled — nothing to retransmit
  expect(wants).toBe(2)
})
