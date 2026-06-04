import type { KeyEvent } from "@opentui/core"
import { canonicalizeKeyEvent, type KeyEventLike } from "../kernel/keymap"

/** Convert an OpenTUI key event into the kernel key representation. */
export function keyEventFromOpentui(key: KeyEvent): KeyEventLike {
  return canonicalizeKeyEvent({
    name: key.name,
    sequence: key.sequence,
    raw: key.raw,
    ctrl: key.ctrl,
    meta: key.meta || key.option,
    shift: key.shift,
    super: key.super,
  })
}
