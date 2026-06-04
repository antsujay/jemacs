import type { BufferModel } from "../kernel/buffer"
import type { LspWorkspace } from "./workspace"

export type LspDiagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  message: string
  source?: string
  code?: string | number
}

export type BufferLspState = {
  workspaces: LspWorkspace[]
  version: number
  uri: string
  lspMode: boolean
}

const stateByBuffer = new WeakMap<BufferModel, BufferLspState>()

export function getBufferLspState(buffer: BufferModel): BufferLspState | undefined {
  return stateByBuffer.get(buffer)
}

export function ensureBufferLspState(buffer: BufferModel, uri: string): BufferLspState {
  let state = stateByBuffer.get(buffer)
  if (!state) {
    state = { workspaces: [], version: 0, uri, lspMode: false }
    stateByBuffer.set(buffer, state)
  }
  state.uri = uri
  return state
}

export function setBufferWorkspaces(buffer: BufferModel, workspaces: LspWorkspace[]): void {
  const state = stateByBuffer.get(buffer)
  if (state) state.workspaces = workspaces
}
