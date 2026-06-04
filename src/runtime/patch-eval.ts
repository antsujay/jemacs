import type { Editor } from "../kernel/editor"
import type { Evaluator } from "./evaluator"
import { definitionRefFromForm, type DefinitionRef } from "./definitions"
import { getCustomVariable, listCustomVariables, patchCustom, restoreCustom } from "./custom"
import {
  getKeyBinding,
  listKeyBindings,
  markKeyBindingPatched,
  restoreKeyBinding,
} from "./key-registry"
import { listTrackedHooks, markHookPatched, restoreTrackedHook } from "../kernel/hooks"
import { getTrackedAdvice, restoreTrackedAdvice } from "./advice"
import { markModePatched, restoreMode } from "../modes/mode"
import { getCatalogEntry, listCatalogEntries } from "./definitions"

export async function evalDefinitionForm(
  editor: Editor,
  evaluator: Evaluator,
  form: string,
  filename: string,
): Promise<DefinitionRef | null> {
  const ref = definitionRefFromForm(form)
  const snapshot = ref ? captureSnapshot(editor, ref) : null
  await evaluator.evalForm(form, filename)
  if (ref) applyPatchFromEval(editor, ref, snapshot)
  return ref
}

type Snapshot =
  | { kind: "command"; fn: unknown; baselineFn: unknown; patched: boolean; source?: unknown }
  | { kind: "variable"; value: unknown; baselineValue: unknown; patched: boolean }
  | { kind: "key"; command: string; baselineCommand: string; patched: boolean }
  | { kind: "hook"; ids: string[] }
  | { kind: "mode" }
  | { kind: "advice"; ids: string[] }

function captureSnapshot(editor: Editor, ref: DefinitionRef): Snapshot | null {
  switch (ref.kind) {
    case "command": {
      const spec = editor.commands.get(ref.name)
      if (!spec) return null
      return { kind: "command", fn: spec.fn, baselineFn: spec.baselineFn ?? spec.fn, patched: !!spec.patched, source: spec.source }
    }
    case "variable": {
      const variable = getCustomVariable(ref.name)
      if (!variable) return null
      return { kind: "variable", value: variable.value, baselineValue: variable.baselineValue ?? variable.value, patched: !!variable.patched }
    }
    case "key": {
      const map = ref.detail ?? "global-map"
      const spec = getKeyBinding(map, ref.name)
      if (!spec) return null
      return { kind: "key", command: spec.command, baselineCommand: spec.baselineCommand ?? spec.command, patched: !!spec.patched }
    }
    case "hook":
      return { kind: "hook", ids: listTrackedHooks(ref.name).map(h => h.id) }
    case "mode":
      return { kind: "mode" }
    case "advice":
      return { kind: "advice", ids: [] }
    default:
      return null
  }
}

function applyPatchFromEval(editor: Editor, ref: DefinitionRef, snapshot: Snapshot | null): void {
  switch (ref.kind) {
    case "command": {
      const spec = editor.commands.get(ref.name)
      if (!spec) return
      const snap = snapshot as Extract<Snapshot, { kind: "command" }> | null
      if (snap && spec.fn !== snap.fn) {
        editor.commands.patch(ref.name, spec.fn, spec.source)
      } else if (!snap) {
        editor.commands.patch(ref.name, spec.fn, spec.source)
      }
      break
    }
    case "variable": {
      const variable = getCustomVariable(ref.name)
      if (!variable) return
      const snap = snapshot as Extract<Snapshot, { kind: "variable" }> | null
      if (snap && variable.value !== snap.value) patchCustom(ref.name, variable.value)
      break
    }
    case "key": {
      const map = ref.detail ?? "global-map"
      const spec = getKeyBinding(map, ref.name)
      if (!spec) return
      const snap = snapshot as Extract<Snapshot, { kind: "key" }> | null
      if (snap && spec.command !== snap.command) {
        markKeyBindingPatched(map, ref.name, spec.command, snap.baselineCommand)
        editor.defineKey(map, ref.name, spec.command)
      }
      break
    }
    case "hook": {
      const snap = snapshot as Extract<Snapshot, { kind: "hook" }> | null
      const before = new Set(snap?.ids ?? [])
      for (const hook of listTrackedHooks(ref.name)) {
        if (!before.has(hook.id) && hook.baselineFn) {
          markHookPatched(hook.id, hook.fn, hook.baselineFn)
        }
      }
      break
    }
    case "mode":
      markModePatched(ref.name)
      break
    case "advice":
      break
  }
}

export function revertDefinition(editor: Editor, ref: DefinitionRef): boolean {
  switch (ref.kind) {
    case "command":
      return editor.commands.restore(ref.name)
    case "variable":
      return restoreCustom(ref.name)
    case "key": {
      const map = ref.detail ?? "global-map"
      const ok = restoreKeyBinding(map, ref.name)
      if (ok) {
        const spec = getKeyBinding(map, ref.name)
        if (spec) editor.defineKey(map, ref.name, spec.command)
      }
      return ok
    }
    case "hook": {
      const hooks = listTrackedHooks(ref.name).filter(h => h.patched)
      const last = hooks.at(-1)
      return last ? restoreTrackedHook(last.id) : false
    }
    case "mode":
      return restoreMode(ref.name)
    case "advice": {
      const entry = getCatalogEntry(ref)
      if (entry?.detail) return restoreTrackedAdvice(entry.detail)
      return false
    }
    default:
      return false
  }
}

export function revertAllDefinitions(editor: Editor): number {
  let count = 0
  for (const name of editor.commands.names()) {
    if (editor.commands.restore(name)) count++
  }
  for (const variable of listCustomVariables()) {
    if (restoreCustom(variable.name)) count++
  }
  for (const binding of listKeyBindings()) {
    if (restoreKeyBinding(binding.map, binding.sequence)) {
      editor.defineKey(binding.map, binding.sequence, binding.command)
      count++
    }
  }
  for (const entry of listCatalogEntries("mode")) {
    if (restoreMode(entry.name)) count++
  }
  for (const hook of listTrackedHooks()) {
    if (hook.patched && restoreTrackedHook(hook.id)) count++
  }
  return count
}
