import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Editor } from "../src/kernel/editor"
import { trackedContext, type PluginContext } from "../src/runtime/plugin-context"

// Second arg is PluginContext for every plugin except compile (which keeps
// CompileDeps positional-2 for test injection); both are optional so the
// builtin loader can pass ctx uniformly without a per-plugin adapter.
type InstallFn = (editor: Editor, ctx?: PluginContext) => void | Promise<void>

/**
 * Explicit, ordered load list. Order matters: state providers first
 * (mark-ring, persist), then editing primitives, then UI, then LSP.
 */
const builtins: Array<[name: string, load: () => Promise<{ install: InstallFn }>]> = [
  ["motion", () => import("./motion")],
  ["window", () => import("./window")],
  ["mark-ring", () => import("./mark-ring")],
  ["save-hooks", () => import("./save-hooks")],
  ["comment-dwim", () => import("./comment-dwim")],
  ["subword", () => import("./subword")],
  ["electric-pair", () => import("./electric-pair")],
  ["show-paren", () => import("./show-paren")],
  ["isearch-regexp", () => import("./isearch-regexp")],
  ["windmove", () => import("./windmove")],
  ["next-error", () => import("./next-error")],
  ["flymake-nav", () => import("./flymake-nav")],
  ["fido", () => import("./fido")],
  ["persist", () => import("./persist")],
  ["auto-revert", () => import("./auto-revert")],
  ["auto-save", () => import("./auto-save")],
  ["lsp-extras", () => import("./lsp-extras")],
  ["lsp-monorepo", () => import("./lsp-monorepo")],
  ["lsp-watchman", () => import("./lsp-watchman")],
  ["which-key", () => import("./which-key")],
  ["eldoc", () => import("./eldoc")],
  ["project", () => import("./project")],
  ["compile", () => import("./compile").then(m => ({ install: (e, ctx) => m.install(e, {}, ctx) }))],
  ["completion-preview", () => import("./completion-preview")],
  ["magit", () => import("./magit")],
  ["dogfood", () => import("./dogfood")],
  ["wdired", () => import("./wdired")],
  ["smerge", () => import("./smerge")],
  ["osc52", () => import("./osc52")],
  ["term-v2", () => import("./term-v2")],
  ["avy", () => import("./avy")],
  ["register-text", () => import("./register-text")],
  ["org", () => import("./org")],
  ["lean4", () => import("./lean4")],
  ["tiling", () => import("./tiling")],
]

const HERE = dirname(fileURLToPath(import.meta.url))

export async function installBuiltinPlugins(editor: Editor): Promise<void> {
  for (const [name, load] of builtins) {
    try {
      const mod = await load()
      // Key by resolved index path so a later evaluator.loadPlugin on the same
      // file finds and disposes this boot-time context before re-installing.
      const ctx = trackedContext(editor, join(HERE, name, "index.ts"))
      await mod.install(editor, ctx)
    } catch (err) {
      editor.message(`plugin ${name} failed: ${(err as Error).message}`)
      console.error(`[plugins/builtin] ${name}:`, err)
    }
  }
}
