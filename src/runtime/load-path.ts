import { resolve } from "node:path"

const paths: string[] = []

export function addToLoadPath(directory: string): void {
  const full = resolve(directory)
  if (!paths.includes(full)) paths.push(full)
}

export function getLoadPath(): readonly string[] {
  return paths
}

export function clearLoadPath(): void {
  paths.length = 0
}
