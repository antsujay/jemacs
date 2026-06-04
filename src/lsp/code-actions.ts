import type { CodeAction, TextEdit, WorkspaceEdit } from "vscode-languageserver-types"
import type { Editor } from "../kernel/editor"
import type { BufferModel } from "../kernel/buffer"
import { diagnosticsForBuffer } from "./diagnostics"
import {
  lspMakeCodeActionContext,
  lspMakeCodeActionParams,
  lspMakeTextDocumentIdentifier,
} from "./lsp-protocol"
import { bufferUri, pointToPosition, positionToPoint } from "./positions"
import type { LspWorkspace } from "./workspace"

function isCodeAction(value: unknown): value is CodeAction {
  const v = value as CodeAction
  return typeof v?.title === "string"
}

function lineRange(buffer: BufferModel): { start: { line: number; character: number }; end: { line: number; character: number } } {
  const bounds = buffer.lineBoundsAt()
  const start = pointToPosition(buffer.text, bounds.start)
  const end = pointToPosition(buffer.text, bounds.end)
  return { start, end }
}

async function ensureLspWorkspaces(editor: Editor, buffer: BufferModel): Promise<LspWorkspace[]> {
  if (!editor.lsp) return []
  let workspaces = editor.lsp.bufferWorkspaces(buffer).filter(w => w.status === "initialized")
  if (!workspaces.length) {
    await editor.lsp.lsp(buffer)
    workspaces = editor.lsp.bufferWorkspaces(buffer).filter(w => w.status === "initialized")
  }
  return workspaces
}

function applyTextEdits(buffer: BufferModel, edits: TextEdit[]): void {
  const sorted = [...edits].sort((a, b) => {
    const pa = positionToPoint(buffer.text, a.range.start)
    const pb = positionToPoint(buffer.text, b.range.start)
    return pb - pa
  })
  for (const edit of sorted) {
    const start = positionToPoint(buffer.text, edit.range.start)
    const end = positionToPoint(buffer.text, edit.range.end)
    buffer.replaceRange(start, end, edit.newText)
  }
}

function applyWorkspaceEditToBuffer(buffer: BufferModel, edit: WorkspaceEdit): boolean {
  const uri = bufferUri(buffer)
  if (!uri || !edit.changes) return false
  const edits = edit.changes[uri]
  if (!edits?.length) return false
  applyTextEdits(buffer, edits)
  return true
}

function applyCodeAction(buffer: BufferModel, action: CodeAction): boolean {
  if (action.edit && applyWorkspaceEditToBuffer(buffer, action.edit)) return true
  if (action.edit?.documentChanges?.length) {
    for (const change of action.edit.documentChanges) {
      if ("textDocument" in change && change.textDocument && "edits" in change) {
        applyTextEdits(buffer, change.edits as TextEdit[])
        return true
      }
    }
  }
  return false
}

export async function lspExecuteCodeAction(editor: Editor, buffer: BufferModel): Promise<void> {
  const workspaces = await ensureLspWorkspaces(editor, buffer)
  if (!workspaces.length) {
    editor.message("LSP is not active for this buffer")
    return
  }

  const range = lineRange(buffer)
  const actions: CodeAction[] = []

  for (const workspace of workspaces) {
    try {
      const diags = diagnosticsForBuffer(buffer, workspace)
      const params = lspMakeCodeActionParams({
        textDocument: lspMakeTextDocumentIdentifier({ uri: workspace.uriForBuffer(buffer) }),
        range,
        context: lspMakeCodeActionContext({ diagnostics: diags }),
      })
      const result = await workspace.rpc.request("textDocument/codeAction", params) as unknown
      if (!result) continue
      const list = Array.isArray(result) ? result : [result]
      for (const item of list) {
        if (isCodeAction(item)) actions.push(item)
        else if (item && typeof item === "object" && "command" in item) {
          const cmd = item as { title?: string; command?: string }
          if (cmd.title) actions.push({ title: cmd.title, command: cmd.command } as CodeAction)
        }
      }
    } catch {
      continue
    }
  }

  if (!actions.length) {
    editor.message("No code actions at point")
    return
  }

  const labels = actions.map((a, i) => `${i + 1}. ${a.title}`)
  const choice = await editor.completingRead("Code action: ", { collection: labels })
  if (!choice) return
  const index = labels.indexOf(choice)
  const action = actions[index >= 0 ? index : 0]!
  if (action.command) {
    editor.message(`Code action command not yet supported: ${action.command}`)
    return
  }
  if (applyCodeAction(buffer, action)) {
    editor.message(`Applied: ${action.title}`)
    await editor.changed("lsp-code-action")
    return
  }
  editor.message(`Code action has no editable change: ${action.title}`)
}
