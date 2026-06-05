import type { BufferModel } from "../kernel/buffer"
import type { Editor } from "../kernel/editor"
import { Keymap, keyToken } from "../kernel/keymap"
import type { KeyEventLike } from "../kernel/keymap"
import { defcustom, getCustom } from "../runtime/custom"
import { defineMinorMode } from "../modes/minor-mode"

const TEXT_SCALE_AMOUNT_KEY = "text-scale-mode-amount"
const TEXT_SCALE_ADJUST_MAP = "text-scale-adjust-map"

const MIN_AMOUNT = -20
const MAX_AMOUNT = 20

defcustom("text-scale-mode-step", "number", 1.2,
  "Each step of text scale multiplies face height by this factor.")

let textScaleAdjustRepeatInc = 1
let textScaleAdjustMap: Keymap | null = null

export function getTextScaleAmount(buffer: BufferModel): number {
  return (buffer.locals.get(TEXT_SCALE_AMOUNT_KEY) as number | undefined) ?? 0
}

export function textScaleFactor(buffer: BufferModel): number {
  const amount = getTextScaleAmount(buffer)
  if (amount === 0) return 1
  const step = getCustom<number>("text-scale-mode-step") ?? 1.2
  return step ** amount
}

export function textScaleLighter(buffer: BufferModel): string {
  const amount = getTextScaleAmount(buffer)
  if (amount === 0) return ""
  return amount >= 0 ? ` +${amount}` : ` ${amount}`
}

function setTextScaleAmount(buffer: BufferModel, amount: number): void {
  if (amount === 0) buffer.locals.delete(TEXT_SCALE_AMOUNT_KEY)
  else buffer.locals.set(TEXT_SCALE_AMOUNT_KEY, amount)
}

function eventBasicType(key: KeyEventLike | null): string | null {
  if (!key) return null
  if (key.sequence?.length === 1) return key.sequence
  const base = keyToken(key).split("-").pop() ?? ""
  if (base.length === 1) return base
  if (base === "plus" || base === "equal") return "="
  if (base === "minus" || base === "hyphen") return "-"
  return base
}

function textScaleStepFromKey(key: KeyEventLike | null, inc: number): number {
  const base = eventBasicType(key)
  if (base === "+" || base === "=") return inc
  if (base === "-") return -inc
  if (base === "0") return 0
  return inc
}

function syncTextScaleMode(editor: Editor, buffer: BufferModel, amount: number): void {
  if (amount === 0) editor.disableMinorMode("text-scale-mode", { buffer })
  else editor.enableMinorMode("text-scale-mode", { buffer })
}

function textScaleSet(editor: Editor, buffer: BufferModel, level: number): void {
  const clamped = Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, level))
  setTextScaleAmount(buffer, clamped)
  syncTextScaleMode(editor, buffer, clamped)
  void editor.changed("text-scale")
}

function textScaleIncrease(editor: Editor, buffer: BufferModel, inc: number): void {
  const current = getTextScaleAmount(buffer)
  const newValue = inc === 0 ? 0 : current + inc
  if (newValue > MAX_AMOUNT || newValue < MIN_AMOUNT) {
    editor.message(`Cannot ${inc > 0 ? "increase" : "decrease"} the font size any further`)
    return
  }
  textScaleSet(editor, buffer, newValue)
}

function installTextScaleAdjustMap(editor: Editor, inc: number): void {
  textScaleAdjustRepeatInc = Math.abs(inc) || 1
  const map = new Keymap(TEXT_SCALE_ADJUST_MAP)
  for (const mods of ["", "C-"]) {
    for (const key of ["+", "=", "-", "0"]) {
      map.bind(`${mods}${key}`, "text-scale-adjust")
    }
  }
  textScaleAdjustMap = map
  editor.overridingMap = map
}

export function clearTextScaleAdjustMap(editor: Editor): void {
  if (textScaleAdjustMap && editor.overridingMap === textScaleAdjustMap) {
    editor.overridingMap = null
  }
  textScaleAdjustMap = null
}

export function installTextScaleMode(): void {
  defineMinorMode({ name: "text-scale-mode" })
}

export function installTextScaleCommands(editor: Editor): void {
  editor.command("text-scale-set", ({ editor, buffer, args, prefixArgument }) => {
    const level = prefixArgument ?? Number(args[0])
    if (!Number.isFinite(level)) return
    textScaleSet(editor, buffer, level)
  }, "Set buffer text scale to LEVEL steps (0 = default).", { interactive: "p" })

  editor.command("text-scale-increase", ({ editor, buffer, args, prefixArgument }) => {
    const inc = prefixArgument ?? Number(args[0])
    if (!Number.isFinite(inc)) return
    textScaleIncrease(editor, buffer, inc)
  }, "Increase buffer text scale by INC steps (0 resets).", { interactive: "p" })

  editor.command("text-scale-decrease", ({ editor, buffer, args, prefixArgument }) => {
    const dec = prefixArgument ?? Number(args[0])
    if (!Number.isFinite(dec)) return
    textScaleIncrease(editor, buffer, -dec)
  }, "Decrease buffer text scale by DEC steps.", { interactive: "p" })

  editor.command("text-scale-adjust", ({ editor, buffer, args, prefixArgument, keyEvent }) => {
    const inc = Math.abs(prefixArgument ?? (Number(args[0]) || textScaleAdjustRepeatInc)) || 1
    if (prefixArgument != null || args[0]) textScaleAdjustRepeatInc = inc
    const step = textScaleStepFromKey(keyEvent, inc)
    textScaleIncrease(editor, buffer, step)
    if (step !== 0) {
      installTextScaleAdjustMap(editor, inc)
      editor.message("Use +, =, -, or 0 for further adjustment")
    } else {
      clearTextScaleAdjustMap(editor)
    }
  }, "Adjust buffer text scale; repeats with +, =, -, or 0.", { interactive: "p" })
}
