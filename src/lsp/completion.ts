import type { BufferModel } from "../kernel/buffer"
import type { CompletionCandidate } from "../modes/mode"
import { pointToPosition } from "./positions"
import type { LspWorkspace } from "./workspace"

type CompletionItem = {
  label: string
  insertText?: string
  textEdit?: { range?: { start: { line: number; character: number }; end: { line: number; character: number } }; newText?: string }
  sortText?: string
}

export async function lspCompletionAtPoint(
  buffer: BufferModel,
  workspaces: LspWorkspace[],
): Promise<CompletionCandidate[]> {
  if (!buffer.path || !workspaces.length) return []
  const symbol = buffer.symbolBoundsAt()
  const position = pointToPosition(buffer.text, buffer.point)

  for (const workspace of workspaces) {
    if (workspace.status !== "initialized") continue
    try {
      const result = await workspace.rpc.request("textDocument/completion", {
        textDocument: { uri: workspace.uriForBuffer(buffer) },
        position,
        context: { triggerKind: 1 },
      }) as CompletionItem[] | { items?: CompletionItem[] } | null

      const items = Array.isArray(result) ? result : result?.items ?? []
      if (!items.length) continue

      const sorted = [...items].sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label))
      return sorted.map(item => {
        const insert = item.textEdit?.newText ?? item.insertText ?? item.label
        const range = item.textEdit?.range
        const start = range ? pointFromLsp(buffer.text, range.start) : symbol.start
        const end = range ? pointFromLsp(buffer.text, range.end) : symbol.end
        return { text: insert, start, end }
      })
    } catch {
      continue
    }
  }
  return []
}

function pointFromLsp(text: string, position: { line: number; character: number }): number {
  const lines = text.split("\n")
  let offset = 0
  for (let i = 0; i < position.line; i++) offset += lines[i]!.length + 1
  const lineText = lines[position.line] ?? ""
  return offset + Math.min(position.character, lineText.length)
}
