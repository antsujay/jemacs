import type { BufferModel } from "../kernel/buffer"
import type { Editor } from "../kernel/editor"
import { setModeSystem } from "../kernel/extension-points"
import { Keymap } from "../kernel/keymap"

export type MinorMode = {
  name: string
  /** Short mode-line indicator, e.g. " Lin" for linum-mode. */
  lighter?: string
  /** When true, enabling applies to all buffers via the editor global set. */
  global?: boolean
  keymap?: Keymap
  onEnable?: (editor: Editor, buffer: BufferModel | null) => void
  onDisable?: (editor: Editor, buffer: BufferModel | null) => void
}

const minorModes = new Map<string, MinorMode>()

export function defineMinorMode(mode: MinorMode): MinorMode {
  const keymap = mode.keymap ?? new Keymap(`${mode.name}-map`)
  const installed = { ...mode, keymap }
  minorModes.set(installed.name, installed)
  return installed
}

export function getMinorMode(name: string): MinorMode | undefined {
  return minorModes.get(name)
}

export function allMinorModes(): MinorMode[] {
  return [...minorModes.values()]
}

setModeSystem({ getMinorMode, allMinorModes })

export function installMinorModeCommands(editor: Editor): void {
  for (const mode of minorModes.values()) {
    const commandName = mode.name
    if (editor.commands.get(commandName)) continue
    editor.command(commandName, ({ editor, buffer, prefixArgument }) => {
      if (prefixArgument === 1) editor.enableMinorMode(commandName, { buffer })
      else if (prefixArgument === 0 || prefixArgument === -1) editor.disableMinorMode(commandName, { buffer })
      else editor.toggleMinorMode(commandName, { buffer })
    }, `Toggle ${commandName}.`)
  }
}
