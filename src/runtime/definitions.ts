import type { SourceLocation } from "./source"

export type DefinitionKind =
  | "command"
  | "variable"
  | "key"
  | "mode"
  | "hook"
  | "advice"
  | "function"

export type DefinitionRef = {
  kind: DefinitionKind
  name: string
  /** Extra id segment (map name for keys, command name for advice). */
  detail?: string
}

export type CatalogEntry = DefinitionRef & {
  source?: SourceLocation
  patched?: boolean
  doc?: string
}

const catalog = new Map<string, CatalogEntry>()

export function catalogId(ref: DefinitionRef): string {
  return ref.detail ? `${ref.kind}:${ref.name}:${ref.detail}` : `${ref.kind}:${ref.name}`
}

export function registerCatalogEntry(entry: CatalogEntry): void {
  catalog.set(catalogId(entry), entry)
}

export function getCatalogEntry(ref: DefinitionRef): CatalogEntry | undefined {
  return catalog.get(catalogId(ref))
}

export function listCatalogEntries(kind?: DefinitionKind): CatalogEntry[] {
  const entries = [...catalog.values()]
  return kind ? entries.filter(e => e.kind === kind) : entries
}

export function markCatalogPatched(ref: DefinitionRef, patched = true): void {
  const entry = getCatalogEntry(ref)
  if (entry) entry.patched = patched
}

export function definitionRefFromForm(form: string): DefinitionRef | null {
  const command = form.match(/editor\.command\s*\(\s*["'`]([^"'`]+)["'`]/)
  if (command) return { kind: "command", name: command[1]! }

  const custom = form.match(/defcustom\s*\(\s*["'`]([^"'`]+)["'`]/)
  if (custom) return { kind: "variable", name: custom[1]! }

  const variable = form.match(/defvar\s*\(\s*["'`]([^"'`]+)["'`]/)
  if (variable) return { kind: "variable", name: variable[1]! }

  const key = form.match(/editor\.key\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/)
  if (key) return { kind: "key", name: key[1]!, detail: "global-map" }

  const defineKey = form.match(/editor\.defineKey\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/)
  if (defineKey) return { kind: "key", name: defineKey[2]!, detail: defineKey[1]! }

  const mode = form.match(/defineMode\s*\(\s*\{[^}]*\bname:\s*["'`]([^"'`]+)["'`]/)
    ?? form.match(/defineMode\s*\(\s*\{[^}]*\bname:\s*(\w+)/)
  if (mode) return { kind: "mode", name: mode[1]! }

  const hook = form.match(/\baddHook\s*\(\s*["'`]([^"'`]+)["'`]/)
  if (hook) return { kind: "hook", name: hook[1]! }

  const advice = form.match(/addAdvice\s*\(\s*["'`]([^"'`]+)["'`]/)
  if (advice) return { kind: "advice", name: advice[1]! }

  const exportFn = form.match(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
  if (exportFn) return { kind: "function", name: exportFn[1]! }

  const plainFn = form.match(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
  if (plainFn) return { kind: "function", name: plainFn[1]! }

  return null
}

export function prepareEvalForm(form: string): string {
  return form
    .replace(/^export\s+default\s+/m, "")
    .replace(/^export\s+/m, "")
}

export function searchableDefinitionNames(): Array<{ label: string; ref: DefinitionRef }> {
  const items: Array<{ label: string; ref: DefinitionRef }> = []
  for (const entry of catalog.values()) {
    const label = entry.detail
      ? `${entry.kind}:${entry.name} (${entry.detail})`
      : `${entry.kind}:${entry.name}`
    items.push({ label, ref: entry })
  }
  return items.sort((a, b) => a.label.localeCompare(b.label))
}
