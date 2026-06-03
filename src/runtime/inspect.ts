export function inspectValue(value: unknown, depth = 3, seen = new WeakSet<object>()): string {
  if (value === null) return "null"
  if (typeof value === "undefined") return "undefined"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (typeof value === "function") return `[Function ${(value as Function).name || "anonymous"}]\n${String(value).slice(0, 1000)}`
  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[Circular]"
  if (depth <= 0) return `[${value.constructor?.name ?? "Object"}]`

  seen.add(value)

  if (value instanceof Map) {
    const lines = [`Map(${value.size}) {`]
    for (const [k, v] of value.entries()) lines.push(`  ${String(k)} => ${indent(inspectValue(v, depth - 1, seen))}`)
    lines.push("}")
    return lines.join("\n")
  }

  if (value instanceof Set) {
    const lines = [`Set(${value.size}) {`]
    for (const v of value.values()) lines.push(`  ${indent(inspectValue(v, depth - 1, seen))}`)
    lines.push("}")
    return lines.join("\n")
  }

  const proto = value.constructor?.name ?? "Object"
  const entries = Object.entries(value as Record<string, unknown>)
  const lines = [`${proto} {`]
  for (const [k, v] of entries) lines.push(`  ${k}: ${indent(inspectValue(v, depth - 1, seen))}`)
  lines.push("}")
  return lines.join("\n")
}

function indent(s: string): string {
  return s.replace(/\n/g, "\n  ")
}
