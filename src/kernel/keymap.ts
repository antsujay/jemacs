export type KeyToken = string

export type KeyEventLike = {
  name: string
  sequence?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

export class Keymap {
  private bindings = new Map<string, string>()
  private pending: string[] = []

  bind(sequence: string, commandName: string): void {
    this.bindings.set(normalizeSequence(sequence), commandName)
  }

  all(): Array<[string, string]> {
    return [...this.bindings.entries()].sort(([a], [b]) => a.localeCompare(b))
  }

  feed(key: KeyEventLike): { status: "matched"; command: string } | { status: "pending" } | { status: "unmatched" } {
    const token = keyToken(key)
    this.pending.push(token)
    const seq = this.pending.join(" ")

    const exact = this.bindings.get(seq)
    if (exact) {
      this.pending = []
      return { status: "matched", command: exact }
    }

    const hasPrefix = [...this.bindings.keys()].some(k => k.startsWith(seq + " "))
    if (hasPrefix) return { status: "pending" }

    this.pending = []
    return { status: "unmatched" }
  }

  clearPending(): void {
    this.pending = []
  }

  pendingSequence(): string {
    return this.pending.join(" ")
  }
}

export function normalizeSequence(sequence: string): string {
  return sequence.trim().split(/\s+/).map(normalizeToken).join(" ")
}

export function normalizeToken(token: string): string {
  const t = token.trim()
  if (!t) return t
  if (/^C-/i.test(t)) return `C-${t.slice(2).toLowerCase()}`
  if (/^M-/i.test(t)) return `M-${t.slice(2).toLowerCase()}`
  return t.toLowerCase()
}

export function keyToken(key: KeyEventLike): string {
  const name = key.name === "return" ? "enter" : key.name === "escape" ? "esc" : key.name
  const base = name === "space" && key.sequence === " " ? "space" : name.toLowerCase()
  if (key.ctrl) return `C-${base}`
  if (key.meta) return `M-${base}`
  return base
}

export function isPrintable(key: KeyEventLike): boolean {
  return !key.ctrl && !key.meta && typeof key.sequence === "string" && key.sequence.length > 0 && (key.name.length === 1 || key.sequence === " ")
}
