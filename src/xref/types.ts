export type XrefLocation = {
  kind: "file" | "buffer"
  path?: string
  bufferId?: string
  line: number
  column: number
  summary?: string
}

export function formatXrefLocation(location: XrefLocation): string {
  if (location.kind === "buffer" && location.bufferId) {
    return `${location.bufferId}:${location.line + 1}:${location.column + 1}`
  }
  const file = location.path ?? "(unknown)"
  const base = file.split("/").pop() ?? file
  return `${base}:${location.line + 1}:${location.column + 1}`
}
