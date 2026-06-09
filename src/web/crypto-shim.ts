/**
 * Browser shim for `node:crypto`: re-export Bun's browser polyfill (which has
 * `createHash`, `randomBytes`) and fill in `timingSafeEqual`, which the
 * polyfill lacks. Only `serveShadow` (server-side) calls `timingSafeEqual`;
 * the browser shadow never reaches it, so the impl here is correctness-only.
 *
 * The build plugin redirects every `node:crypto` import here *except* the one
 * on the next line, so the re-export resolves to the real polyfill.
 */
// @ts-ignore — resolved to Bun's browser polyfill by the build plugin
export * from "node:crypto"

export function timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  const ab = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  if (ab.length !== bb.length) return false
  let r = 0
  for (let i = 0; i < ab.length; i++) r |= ab[i]! ^ bb[i]!
  return r === 0
}
