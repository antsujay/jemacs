import { normalizeSequence } from "../kernel/keymap"
import type { Editor } from "../kernel/editor"
import { registerCatalogEntry, type DefinitionRef } from "./definitions"
import type { SourceLocation } from "./source"
import { captureCallerSource } from "./source"

export type KeyBindingSpec = {
  map: string
  sequence: string
  command: string
  source?: SourceLocation
  baselineCommand?: string
  patched?: boolean
}

const bindings = new Map<string, KeyBindingSpec>()

function bindingKey(map: string, sequence: string): string {
  return `${map}\0${normalizeSequence(sequence)}`
}

export function registerKeyBinding(map: string, sequence: string, command: string, source?: SourceLocation): void {
  const key = bindingKey(map, sequence)
  const normalized = normalizeSequence(sequence)
  const existing = bindings.get(key)
  const loc = source ?? captureCallerSource(3)
  if (!existing) {
    bindings.set(key, { map, sequence: normalized, command, source: loc, baselineCommand: command, patched: false })
  } else {
    existing.command = command
    if (loc) existing.source = loc
    if (!existing.patched) existing.baselineCommand = command
  }
  registerCatalogEntry({
    kind: "key",
    name: normalized,
    detail: map,
    source: loc,
    patched: existing?.patched,
    doc: `Runs command ${command}`,
  })
}

export function applyKeyBinding(editor: Editor, map: string, sequence: string, command: string, source?: SourceLocation): void {
  registerKeyBinding(map, sequence, command, source)
  if (map === "global-map" || map === "global") editor.keymap.bind(sequence, command)
  else if (map === "minibuffer-local-map" || map === "minibuffer") editor.minibufferKeymap.bind(sequence, command)
  else editor.defineKey(map, sequence, command)
}

export function getKeyBinding(map: string, sequence: string): KeyBindingSpec | undefined {
  return bindings.get(bindingKey(map, sequence))
}

export function listKeyBindings(): KeyBindingSpec[] {
  return [...bindings.values()].sort((a, b) => a.map.localeCompare(b.map) || a.sequence.localeCompare(b.sequence))
}

export function restoreKeyBinding(map: string, sequence: string): boolean {
  const spec = getKeyBinding(map, sequence)
  if (!spec?.patched || spec.baselineCommand == null) return false
  spec.command = spec.baselineCommand
  spec.patched = false
  return true
}

export function snapshotKeyBinding(map: string, sequence: string): KeyBindingSpec | undefined {
  const spec = getKeyBinding(map, sequence)
  return spec ? { ...spec } : undefined
}

export function markKeyBindingPatched(map: string, sequence: string, command: string, baselineCommand: string): void {
  const spec = getKeyBinding(map, sequence)
  if (!spec) return
  spec.command = command
  if (!spec.baselineCommand) spec.baselineCommand = baselineCommand
  spec.patched = true
}

export function keyBindingRef(map: string, sequence: string): DefinitionRef {
  return { kind: "key", name: normalizeSequence(sequence), detail: map }
}
