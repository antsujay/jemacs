import type { Location, LocationLink, Range } from "vscode-languageserver-types"

export type ResolvedLocation = { uri: string; range: Range }

function isLocation(value: unknown): value is Location {
  const v = value as Location
  return typeof v?.uri === "string" && v.range != null && typeof v.range.start === "object"
}

function isLocationLink(value: unknown): value is LocationLink {
  const v = value as LocationLink
  return typeof v?.targetUri === "string" && v.targetRange != null
}

function fromLocation(location: Location): ResolvedLocation {
  return { uri: location.uri, range: location.range }
}

function fromLocationLink(link: LocationLink): ResolvedLocation {
  return {
    uri: link.targetUri,
    range: link.targetSelectionRange ?? link.targetRange,
  }
}

/** Normalize `textDocument/definition` (and similar) results to file locations. */
export function normalizeLocations(result: unknown): ResolvedLocation[] {
  if (result == null) return []
  if (Array.isArray(result)) {
    const out: ResolvedLocation[] = []
    for (const item of result) out.push(...normalizeLocations(item))
    return out
  }
  if (isLocation(result)) return [fromLocation(result)]
  if (isLocationLink(result)) return [fromLocationLink(result)]
  return []
}

export function formatLocation(path: string, range: Range): string {
  return `${path}:${range.start.line + 1}:${range.start.character + 1}`
}
