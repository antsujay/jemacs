import { Editor } from "../../src/kernel/editor"
import { installDefaultModes } from "../../src/modes/default-modes"
import { installDefaultConfig } from "../../src/config"
import { clearAdvice } from "../../src/runtime/advice"
import { clearHooks } from "../../src/kernel/hooks"
import { listCatalogEntries } from "../../src/runtime/definitions"

// electric-pair and completion-preview guard their addAdvice("self-insert-command")
// with a module-level flag, so they cannot re-register after a clear; leave that
// command's advice alone (both advisors no-op when their minor mode is disabled).
const GUARDED_ADVICE = new Set(["self-insert-command"])

/** Editor with default modes/commands/bindings, ready for a plugin's `install`. */
export function makeEditor(): Editor {
  // advice/hooks are process-global and append-only; drop whatever earlier test
  // files left behind so every makeEditor() starts from the same baseline (t-f35ebf).
  for (const name of new Set(listCatalogEntries("advice").map(e => e.name))) {
    if (!GUARDED_ADVICE.has(name)) clearAdvice(name)
  }
  clearHooks()
  installDefaultModes()
  const editor = new Editor()
  installDefaultConfig(editor)
  return editor
}
