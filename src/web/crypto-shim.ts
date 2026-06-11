/**
 * Browser shim for `node:crypto`: re-export Bun's browser polyfill and fill
 * in what it lacks (`createHash`, `timingSafeEqual`). The build plugin
 * redirects every `node:crypto` import here *except* the one on the next
 * line, so the re-export resolves to the real polyfill.
 */
// @ts-ignore — resolved to Bun's browser polyfill by the build plugin
export * from "node:crypto"

import { sha256Hex } from "./sha256"

/** Bun's browser polyfill turns out NOT to ship `createHash` — supply a sync
 *  sha256-only one for the CAS path. */
export function createHash(algo: string): { update(s: string): { digest(enc: "hex"): string } } {
  if (algo !== "sha256") throw new Error(`crypto-shim: createHash only supports sha256 (got ${algo})`)
  let acc = ""
  return {
    update(s: string) { acc += s; return { digest: () => sha256Hex(acc) } },
  }
}

export function timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  const ab = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  if (ab.length !== bb.length) return false
  let r = 0
  for (let i = 0; i < ab.length; i++) r |= ab[i]! ^ bb[i]!
  return r === 0
}
