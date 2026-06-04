import type { WindowNode } from "./window"

export type RegisterContents =
  | { kind: "point"; point: number }
  | { kind: "window-configuration"; layout: WindowNode; selectedWindowId: string; currentBufferId: string }
