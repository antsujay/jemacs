/** Seeded PRNG for DST. mulberry32: 32-bit state, decent distribution, fast,
 *  and reproducible across platforms (no Math.random, no float drift). */
export class SeededRng {
  private a: number

  constructor(seed: number) {
    this.a = seed >>> 0
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** Uniform pick from a non-empty array. */
  choice<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("SeededRng.choice: empty array")
    return arr[this.int(arr.length)]!
  }
}
