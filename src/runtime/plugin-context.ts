import type { Editor } from "../kernel/editor"
import type { CommandFn } from "../kernel/command"
import { addHook, removeHook, type HookFn } from "../kernel/hooks"
import { addAdvice, type CommandAdvice } from "./advice"
import { applyKeyBinding } from "./key-registry"

type Disposer = () => void

/**
 * Per-plugin registration surface. Thin wrappers over editor.command /
 * defineKey / addHook / addAdvice that also record an undo thunk so
 * dispose() can tear the plugin down cleanly before a reload.
 */
export type PluginContext = {
  command(name: string, fn: CommandFn, doc?: string): void
  key(map: string, seq: string, cmd: string): void
  hook(name: string, fn: HookFn): void
  advice(cmd: string, advice: CommandAdvice): void
  onDispose(fn: Disposer): void
  dispose(): void
}

export function createPluginContext(editor: Editor): PluginContext {
  const disposers: Disposer[] = []
  return {
    command(name, fn, doc) {
      editor.command(name, fn, doc)
      // CommandRegistry.define overwrites in place; re-install replaces it.
    },
    key(map, seq, cmd) {
      applyKeyBinding(editor, map, seq, cmd)
      // Keymaps overwrite on re-bind; explicit unbind not yet supported.
    },
    hook(name, fn) {
      addHook(name, fn)
      disposers.push(() => removeHook(name, fn))
    },
    advice(cmd, adv) {
      addAdvice(cmd, adv)
      // No removeAdvice export yet; tracked but survives dispose for now.
    },
    onDispose(fn) {
      disposers.push(fn)
    },
    dispose() {
      while (disposers.length) {
        try { disposers.pop()!() } catch { /* keep tearing down */ }
      }
    },
  }
}
