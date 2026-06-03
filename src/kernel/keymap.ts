export type KeyToken = string

export type KeyEventLike = {
  name: string
  sequence?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

export type KeyLookupResult =
  | { status: "matched"; command: string; mapName: string }
  | { status: "pending"; mapName: string }
  | { status: "unmatched" }

export class Keymap {
  private bindings = new Map<string, string>()
  private pending: string[] = []

  constructor(readonly name = "keymap") {}

  bind(sequence: string, commandName: string): void {
    this.bindings.set(normalizeSequence(sequence), commandName)
  }

  get(sequence: string): string | undefined {
    return this.bindings.get(normalizeSequence(sequence))
  }

  hasPrefix(sequence: string): boolean {
    const normalized = normalizeSequence(sequence)
    return [...this.bindings.keys()].some(k => k.startsWith(normalized + " "))
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

    if (this.hasPrefix(seq)) return { status: "pending" }

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

export class KeymapStack {
  private pending: string[] = []

  constructor(private readonly maps: () => Array<{ name: string; keymap: Keymap }>) {}

  feed(key: KeyEventLike): KeyLookupResult {
    this.pending.push(keyToken(key))
    const sequence = this.pending.join(" ")
    const result = this.lookup(sequence)

    if (result.status === "matched") {
      this.pending = []
      return result
    }

    if (result.status === "pending") return result

    this.pending = []
    return result
  }

  lookup(sequence: string): KeyLookupResult {
    const normalized = normalizeSequence(sequence)
    let pendingMap: string | null = null

    for (const { name, keymap } of this.maps()) {
      const command = keymap.get(normalized)
      if (command) return { status: "matched", command, mapName: name }
      if (!pendingMap && keymap.hasPrefix(normalized)) pendingMap = name
    }

    return pendingMap ? { status: "pending", mapName: pendingMap } : { status: "unmatched" }
  }

  describe(sequence: string): { sequence: string; command: string; mapName: string } | null {
    const normalized = normalizeSequence(sequence)
    const result = this.lookup(normalized)
    if (result.status !== "matched") return null
    return { sequence: normalized, command: result.command, mapName: result.mapName }
  }

  clearPending(): void {
    this.pending = []
  }

  pendingSequence(): string {
    return this.pending.join(" ")
  }
}

export function normalizeSequence(sequence: string): string {
  return sequence.trim().split(/\s+/).filter(Boolean).map(normalizeToken).join(" ")
}

export function normalizeToken(token: string): string {
  const t = token.trim()
  if (!t) return t
  if (/^C-/i.test(t)) return `C-${t.slice(2).toLowerCase()}`
  if (/^M-/i.test(t)) return `M-${t.slice(2).toLowerCase()}`
  return t.toLowerCase()
}

export function keyToken(key: KeyEventLike): string {
  const macOptionMeta = macOptionMetaKey(key)
  if (macOptionMeta) return `M-${macOptionMeta}`

  const name = key.name === "return" ? "enter" : key.name === "escape" ? "esc" : key.name
  const base = name === "space" && key.sequence === " " ? "space" : name.toLowerCase()
  if (key.ctrl) return `C-${base}`
  if (key.meta) return `M-${base}`
  return base
}

export function isMetaKey(key: KeyEventLike): boolean {
  return key.meta === true || macOptionMetaKey(key) != null
}

export function isPrintable(key: KeyEventLike): boolean {
  return !key.ctrl && !isMetaKey(key) && typeof key.sequence === "string" && key.sequence.length > 0 && (key.name.length === 1 || key.sequence === " ")
}

function macOptionMetaKey(key: KeyEventLike): string | null {
  const value = key.sequence ?? key.name
  switch (value) {
    case "∫":
      return "b"
    case "ƒ":
      return "f"
    case "≈":
      return "x"
    default:
      return null
  }
}
