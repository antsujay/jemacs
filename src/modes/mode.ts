import type { BufferModel } from "../kernel/buffer"

export type Mode = {
  name: string
  commentStart?: string
  onEnter?: (buffer: BufferModel) => void
}

export const modes = new Map<string, Mode>()

export function defineMode(mode: Mode): void {
  modes.set(mode.name, mode)
}

export function getMode(name: string): Mode | undefined {
  return modes.get(name)
}
