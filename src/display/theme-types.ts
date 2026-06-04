import type { FaceName } from "../modes/mode"

export type FaceStyle = {
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type Theme = {
  name: string
  faces: Partial<Record<FaceName, FaceStyle>>
}

export function defineTheme(name: string, faces: Partial<Record<FaceName, FaceStyle>>): Theme {
  return { name, faces }
}
