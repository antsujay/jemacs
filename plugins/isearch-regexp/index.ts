import type { Editor } from "../../src/kernel/editor"
import { createPluginContext, type PluginContext } from "../../src/runtime/plugin-context"
import {
  findMatchBackward,
  findMatchForward,
  isearchNoUpperCaseP,
  isearchPrompt,
  setIsearchRegexp,
} from "../../src/kernel/isearch"

export { isearchNoUpperCaseP }

export function install(editor: Editor, ctx: PluginContext = createPluginContext(editor)): void {
  function start(direction: 1 | -1, regexp: boolean): void {
    setIsearchRegexp(regexp)
    editor.startIsearch(direction)
    if (editor.isearch) {
      editor.isearch.regexp = regexp
      editor.message(isearchPrompt(editor.isearch))
    }
  }

  function repeatRegexp(direction: 1 | -1): void {
    const state = editor.isearch
    if (!state?.string) return
    const buffer = editor.buffers.get(state.bufferId)
    if (!buffer) return
    const next = direction === 1
      ? findMatchForward(buffer.text, state.string, buffer.point, true)
      : findMatchBackward(buffer.text, state.string, buffer.point, true)
    if (!next) {
      editor.message(`Failing ${isearchPrompt(state)}`)
      return
    }
    editor.applyIsearchMatch(buffer, state, next)
    editor.message(isearchPrompt(state))
  }

  function go(direction: 1 | -1, regexp: boolean): void {
    const state = editor.isearch
    if (!state) return start(direction, regexp)
    state.direction = direction
    state.regexp = regexp
    setIsearchRegexp(regexp)
    if (regexp) repeatRegexp(direction)
    else editor.isearchRepeat()
  }

  editor.command("isearch-forward", () => go(1, false),
    "Incremental search forward (smart case-fold).")
  editor.command("isearch-backward", () => go(-1, false),
    "Incremental search backward (smart case-fold).")

  editor.command("isearch-forward-regexp", () => go(1, true),
    "Incremental regexp search forward.")
  editor.command("isearch-backward-regexp", () => go(-1, true),
    "Incremental regexp search backward.")

  editor.key("C-M-s", "isearch-forward-regexp")
  editor.key("C-M-r", "isearch-backward-regexp")
}
