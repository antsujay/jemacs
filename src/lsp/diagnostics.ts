import type { BufferModel } from "../kernel/buffer"
import type { TextSpan } from "../modes/mode"
import { positionToPoint, uriToPath } from "./positions"
import type { LspDiagnostic } from "./buffer-state"
import type { LspWorkspace } from "./workspace"

export function handlePublishDiagnostics(workspace: LspWorkspace, params: unknown): void {
  const record = params as { uri?: string; diagnostics?: LspDiagnostic[] }
  if (!record.uri) return
  const path = uriToPath(record.uri)
  workspace.diagnosticsByPath.set(path, record.diagnostics ?? [])
  workspace.onDiagnosticsUpdated?.(path)
}

export function diagnosticsForBuffer(buffer: BufferModel, workspace: LspWorkspace): LspDiagnostic[] {
  if (!buffer.path) return []
  return workspace.diagnosticsByPath.get(buffer.path) ?? []
}

export function diagnosticSpans(buffer: BufferModel, workspaces: LspWorkspace[]): TextSpan[] {
  const spans: TextSpan[] = []
  for (const workspace of workspaces) {
    for (const diag of diagnosticsForBuffer(buffer, workspace)) {
      const start = positionToPoint(buffer.text, diag.range.start)
      const end = positionToPoint(buffer.text, diag.range.end)
      if (end <= start) continue
      spans.push({ start, end, face: severityFace(diag.severity) })
    }
  }
  return spans
}

function severityFace(severity?: number): TextSpan["face"] {
  if (severity === 1) return "error"
  if (severity === 2) return "error"
  if (severity === 3) return "comment"
  return "comment"
}
