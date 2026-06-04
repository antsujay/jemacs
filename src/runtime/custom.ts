export type CustomType = "boolean" | "string" | "number"

export type CustomVariable<T = unknown> = {
  name: string
  type: CustomType
  value: T
  doc?: string
}

const variables = new Map<string, CustomVariable>()

export function defcustom<T>(name: string, type: CustomType, value: T, doc?: string): CustomVariable<T> {
  const existing = variables.get(name)
  if (existing) {
    existing.value = value as unknown
    return existing as CustomVariable<T>
  }
  const variable: CustomVariable<T> = { name, type, value, doc }
  variables.set(name, variable as CustomVariable)
  return variable
}

export function defvar<T>(name: string, value: T, doc?: string): CustomVariable<T> {
  const type: CustomType = typeof value === "boolean"
    ? "boolean"
    : typeof value === "number"
      ? "number"
      : "string"
  return defcustom(name, type, value, doc)
}

export function getCustom<T>(name: string): T | undefined {
  return variables.get(name)?.value as T | undefined
}

export function setCustom<T>(name: string, value: T): void {
  const variable = variables.get(name)
  if (!variable) throw new Error(`Unknown custom variable: ${name}`)
  variable.value = value as unknown
}

export function listCustomVariables(): CustomVariable[] {
  return [...variables.values()].sort((a, b) => a.name.localeCompare(b.name))
}
