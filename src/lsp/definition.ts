import type { Location, LocationLink } from "vscode-languageserver-types"
import type { BufferModel } from "../kernel/buffer"
import { pointToPosition, uriToPath } from "./positions"
import type { LspWorkspace } from "./workspace"
import {
  lspMakeDefinitionParams,
  lspMakePosition,
  lspMakeTextDocumentIdentifier,
} from "./lsp-protocol"
import type { XrefLocation } from "../xref/types"

export function parseDefinitionResult(result: unknown): XrefLocation[] {
  if (!result) return []
  const items = Array.isArray(result) ? result : [result]
  const locations: XrefLocation[] = []
  for (const item of items) {
    if (isLocationLink(item)) {
      locations.push({
        kind: "file",
        path: uriToPath(item.targetUri),
        line: item.targetRange.start.line,
        column: item.targetRange.start.character,
        summary: item.targetUri,
      })
      continue
    }
    if (isLocation(item)) {
      locations.push({
        kind: "file",
        path: uriToPath(item.uri),
        line: item.range.start.line,
        column: item.range.start.character,
        summary: item.uri,
      })
    }
  }
  return locations
}

export async function lspDefinitionsAtPoint(
  buffer: BufferModel,
  workspaces: LspWorkspace[],
): Promise<XrefLocation[]> {
  if (!buffer.path || !workspaces.length) return []
  const position = pointToPosition(buffer.text, buffer.point)

  for (const workspace of workspaces) {
    if (workspace.status !== "initialized") continue
    try {
      const params = lspMakeDefinitionParams({
        textDocument: lspMakeTextDocumentIdentifier({ uri: workspace.uriForBuffer(buffer) }),
        position: lspMakePosition({ line: position.line, character: position.character }),
      })
      const result = await workspace.rpc.request("textDocument/definition", params)
      const locations = parseDefinitionResult(result)
      if (locations.length) return locations
    } catch {
      continue
    }
  }
  return []
}

function isLocation(value: unknown): value is Location {
  return typeof value === "object" && value != null && "uri" in value && "range" in value
}

function isLocationLink(value: unknown): value is LocationLink {
  return typeof value === "object" && value != null && "targetUri" in value && "targetRange" in value
}
