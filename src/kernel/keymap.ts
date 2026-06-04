export type KeyToken = string

export type KeyEventLike = {
  name: string
  sequence?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  super?: boolean
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
  const raw = token.trim()
  if (!raw) return raw
  const parts = raw.split("-")
  const key = normalizeKeyName(parts.pop() ?? "")
  const lowerMods = new Set(parts.map(p => p.toLowerCase()))
  const hasShift = parts.some(p => p === "S" || p.toLowerCase() === "shift")
  const hasSuper = parts.some(p => p === "s" || ["super", "cmd", "command"].includes(p.toLowerCase()))
  const ordered = [
    lowerMods.has("c") || lowerMods.has("ctrl") ? "C" : null,
    lowerMods.has("m") || lowerMods.has("meta") || lowerMods.has("alt") ? "M" : null,
    hasShift ? "S" : null,
    hasSuper ? "s" : null,
  ].filter(Boolean)
  return [...ordered, key].join("-")
}

export function keyToken(key: KeyEventLike): string {
  const macOptionMeta = macOptionMetaKey(key)
  if (macOptionMeta) return `M-${macOptionMeta}`

  const base = normalizeKeyName(key.name === "return" ? "enter" : key.name === "escape" ? "esc" : key.name === "space" && key.sequence === " " ? "space" : key.name)
  const mods = [
    key.ctrl ? "C" : null,
    key.meta ? "M" : null,
    key.shift ? "S" : null,
    key.super ? "s" : null,
  ].filter(Boolean)
  return [...mods, base].join("-")
}

export function isMetaKey(key: KeyEventLike): boolean {
  return key.meta === true || macOptionMetaKey(key) != null
}

export function isPrintable(key: KeyEventLike): boolean {
  return !key.ctrl && !key.super && !isMetaKey(key) && typeof key.sequence === "string" && key.sequence.length > 0 && (key.name.length === 1 || key.sequence === " ")
}

function normalizeKeyName(name: string): string {
  return name.toLowerCase().replace(/^<(.+)>$/, "$1")
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
    case "≥":
      return "."
    case "≤":
      return ","
    default:
      return null
  }
}
