/// <reference lib="dom" />
/**
 * Browser entry for the shadow (S) side: a full `Editor` running in the page,
 * attached to a remote authority over a WebSocket. Built by
 * `scripts/build-shadow-web.ts` → `dist/shadow-web/editor.js`.
 *
 * Phase-5 scope (DESIGN.md §Filesystem replica): no local FS — `readFile` /
 * `spawn` / `stat` throw `NotImplementedInBrowser` via `node-stubs.ts`. All
 * buffer content arrives over the link (`BufferRef` → CAS or `Chunk`).
 */

import { Editor } from "../kernel/editor"
import { installDefaultConfig } from "../config"
import { installLisp } from "../../lisp"
import { installDefaultModes } from "../modes/default-modes"
import { attachShadow } from "../shadow/shadow"
import { MemCas } from "../shadow/cas"
import { WsLink, connectWs } from "../shadow/ws-link"
import { setPlatformRuntime } from "../platform/runtime"
import { buildLogicalModel } from "../display/logical"
import { webLayout } from "./web-layout"
import { presentDomFrame, type DomFrameTargets } from "../display/dom-frame"
import { domKeyFromKeyboardEvent, isDomModifierOnlyKey } from "../electron/dom-key"

function notImplemented(name: string): never {
  throw new Error(`${name}: not implemented in browser shadow (phase-6 supplies the manifest+CAS-backed runtime)`)
}

// Phase-6 swaps this for the manifest+CAS-backed impl; until then every
// platform call that escapes the link is a loud failure, not silent emptiness.
setPlatformRuntime({
  readFileText: path => notImplemented(`readFileText(${path})`),
  writeFileText: path => notImplemented(`writeFileText(${path})`),
  fileExists: async () => false,
  spawnProcess: () => notImplemented("spawnProcess"),
  whichExecutable: () => null,
})

export type ShadowMountOptions = {
  /** Defaults to `ws://${location.host}/shadow`. */
  wsUrl?: string
  /** Existing DOM targets; if omitted, the renderer.html ids are looked up. */
  targets?: DomFrameTargets
  /** Skip `installDefaultConfig` (test harness installs its own). */
  bare?: boolean
}

function defaultTargets(): DomFrameTargets | undefined {
  const title = document.getElementById("jemacs-title")
  const windows = document.getElementById("jemacs-windows")
  const minibuffer = document.getElementById("jemacs-minibuffer")
  const echo = document.getElementById("jemacs-echo")
  if (!title || !windows || !minibuffer || !echo) return undefined
  return {
    title, windows, minibuffer, echo,
    minibufferCompletions: document.getElementById("jemacs-minibuffer-completions") ?? undefined,
  }
}

/** Construct an Editor and connect it as a shadow over `wsUrl`. Returns the
 *  editor + link so a hosting page (or test) can drive it further. */
export function mountShadowEditor(options: ShadowMountOptions = {}): { editor: Editor; link: WsLink } {
  installDefaultModes()
  const editor = new Editor()
  // installDefaultConfig calls installLisp internally; the bare path is for the
  // bundle test, which only needs `new Editor()` to succeed.
  if (!options.bare) {
    try { installDefaultConfig(editor) }
    catch (err) { console.warn("[shadow] default config partially loaded:", err) }
  }

  const wsUrl = options.wsUrl ?? `ws://${location.host}/shadow`
  const link = connectWs(wsUrl)
  attachShadow(editor, link, { cas: new MemCas() })

  const targets = options.targets ?? defaultTargets()
  let lastMessage = ""
  editor.events.on("message", ({ text }) => { lastMessage = text })
  const render = () => {
    if (!targets) return
    const model = webLayout(buildLogicalModel(editor, { lastMessage, hostLabel: "Jemacs Shadow" }))
    presentDomFrame(targets, model)
  }
  editor.events.on("changed", () => render())
  render()

  if (targets) {
    document.addEventListener("keydown", ev => {
      if (ev.defaultPrevented || isDomModifierOnlyKey(ev.key)) return
      void editor.handleKey(domKeyFromKeyboardEvent(ev))
      ev.preventDefault()
    })
  }

  return { editor, link }
}

// ── Global surface ──────────────────────────────────────────────────────────
// Exposed so the bundle test (and a hosting page's inline script) can reach
// these without an import map.

export { Editor, attachShadow, connectWs, WsLink, MemCas, installDefaultConfig, installLisp }

;(globalThis as Record<string, unknown>).JemacsShadow = {
  Editor, attachShadow, connectWs, WsLink, MemCas,
  installDefaultConfig, installLisp, installDefaultModes,
  buildLogicalModel, webLayout, presentDomFrame,
  mountShadowEditor,
}

// Auto-mount when served inside the standard renderer.html shell. A test page
// without those elements gets the global surface only.
if (typeof document !== "undefined" && document.getElementById("jemacs-root")) {
  mountShadowEditor()
}
