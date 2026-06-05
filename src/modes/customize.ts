import type { Editor } from "../kernel/editor"
import { Keymap } from "../kernel/keymap"
import { defineMode, getMode } from "./mode"
import {
  getCustomVariable,
  listCustomVariables,
  resetCustom,
  resetCustomToSaved,
  saveCustom,
  setCustom,
  type CustomType,
  type CustomVariable,
} from "../runtime/custom"

export const CUSTOMIZE_VARIABLE_KEY = "jemacs-customize-variable"

export function installCustomizeMode(): void {
  const keymap = new Keymap("customize-mode-map")
  for (const key of ["return", "enter", "RET"]) keymap.bind(key, "customize-set")
  keymap.bind("s", "customize-set")
  keymap.bind("S-s", "customize-save")
  keymap.bind("r", "customize-reset")
  keymap.bind("u", "customize-reset-saved")
  keymap.bind("d", "customize-describe")
  keymap.bind("g", "customize-refresh")
  defineMode({ name: "customize-mode", parent: "text", keymap })
}

export function installCustomizeCommands(editor: Editor): void {
  if (!getMode("customize-mode")) installCustomizeMode()

  editor.command("customize", ({ editor }) => {
    showCustomizeBuffer(editor, listCustomVariables(), "Customize Jemacs")
  }, "Select a customization buffer which you can use to set user options.")

  editor.command("customize-group", async ({ editor, args }) => {
    const group = args[0] ?? await editor.completingRead("Customize group: ", {
      collection: customizeGroups(),
      history: "customize-group",
      initialValue: "jemacs",
    })
    if (!group) return
    showCustomizeBuffer(editor, variablesForGroup(group), `Customize Group: ${group}`)
  }, "Customize GROUP, which must be a customization group.")

  editor.command("customize-variable", async ({ editor, args }) => {
    const name = args[0] ?? await editor.completingRead("Customize variable: ", {
      collection: listCustomVariables().map(variable => variable.name),
      history: "variable",
    })
    if (!name) return
    const variable = getCustomVariable(name)
    if (!variable) {
      editor.message(`No user option named ${name}`)
      return
    }
    showCustomizeBuffer(editor, [variable], `Customize Option: ${name}`)
  }, "Customize SYMBOL, which must be a user option.")

  editor.command("customize-option", async ctx => {
    await ctx.editor.run("customize-variable", ctx.args)
  }, "Customize SYMBOL, which must be a user option.")

  editor.command("customize-set", async ({ editor }) => {
    const variable = customizeVariableAtPoint(editor)
    if (!variable) {
      editor.message("No custom option on this line")
      return
    }
    const value = await readCustomValue(editor, variable)
    if (value == null) return
    setCustom(variable.name, value)
    refreshCustomizeBuffer(editor)
    editor.message(`Set ${variable.name}`)
  }, "Set the custom option at point for this session.")

  editor.command("customize-save", async ({ editor }) => {
    const variable = customizeVariableAtPoint(editor)
    if (!variable) {
      editor.message("No custom option on this line")
      return
    }
    const value = await readCustomValue(editor, variable)
    if (value == null) return
    saveCustom(variable.name, value)
    refreshCustomizeBuffer(editor)
    editor.message(`Saved ${variable.name}`)
  }, "Set and save the custom option at point.")

  editor.command("customize-reset", ({ editor }) => {
    const variable = customizeVariableAtPoint(editor)
    if (!variable) {
      editor.message("No custom option on this line")
      return
    }
    if (!resetCustom(variable.name)) editor.message(`Could not reset ${variable.name}`)
    else {
      refreshCustomizeBuffer(editor)
      editor.message(`Reset ${variable.name} to standard value`)
    }
  }, "Reset the custom option at point to its standard value.")

  editor.command("customize-reset-saved", ({ editor }) => {
    const variable = customizeVariableAtPoint(editor)
    if (!variable) {
      editor.message("No custom option on this line")
      return
    }
    if (!resetCustomToSaved(variable.name)) editor.message(`${variable.name} has no saved value`)
    else {
      refreshCustomizeBuffer(editor)
      editor.message(`Reset ${variable.name} to saved value`)
    }
  }, "Reset the custom option at point to its saved value.")

  editor.command("customize-describe", async ({ editor }) => {
    const variable = customizeVariableAtPoint(editor)
    if (!variable) {
      editor.message("No custom option on this line")
      return
    }
    await editor.run("describe-variable", [variable.name])
  }, "Describe the custom option at point.")

  editor.command("customize-refresh", ({ editor }) => {
    refreshCustomizeBuffer(editor)
    editor.message("Refreshed customize buffer")
  }, "Refresh the current customize buffer.")
}

function showCustomizeBuffer(editor: Editor, variables: CustomVariable[], title: string): void {
  const body = formatCustomizeBuffer(title, variables)
  const buffer = editor.scratch("*Customize*", body, "customize-mode")
  buffer.readOnly = true
  buffer.locals.set(CUSTOMIZE_VARIABLE_KEY, variables.map(variable => variable.name))
  buffer.point = body.indexOf("Variable: ")
  if (buffer.point < 0) buffer.point = 0
}

function refreshCustomizeBuffer(editor: Editor): void {
  const names = editor.currentBuffer.locals.get(CUSTOMIZE_VARIABLE_KEY) as string[] | undefined
  const title = editor.currentBuffer.text.split("\n", 1)[0] || "Customize Jemacs"
  const variables = names?.map(name => getCustomVariable(name)).filter((v): v is CustomVariable => Boolean(v))
    ?? listCustomVariables()
  showCustomizeBuffer(editor, variables, title)
}

function formatCustomizeBuffer(title: string, variables: CustomVariable[]): string {
  const lines = [
    title,
    "",
    "Keys: RET/s set, S save, r reset, u reset-saved, d describe, g refresh",
    "",
  ]
  if (!variables.length) {
    lines.push("No custom options match.")
    return lines.join("\n")
  }
  for (const variable of variables) {
    lines.push(
      `Variable: ${variable.name}`,
      `  Value: ${JSON.stringify(variable.value)}`,
      `  Type: ${variable.type}`,
      `  State: ${customState(variable)}`,
    )
    if (variable.doc) lines.push(`  ${variable.doc}`)
    lines.push("")
  }
  return lines.join("\n")
}

function customState(variable: CustomVariable): string {
  if (variable.patched) return "CHANGED outside Customize"
  if (variable.savedValue !== undefined && Object.is(variable.value, variable.savedValue)) return "SAVED and set"
  if (variable.customized) return "SET for current session"
  return "STANDARD"
}

function customizeVariableAtPoint(editor: Editor): CustomVariable | null {
  const line = editor.currentBuffer.lineBoundsAt().text
  const direct = /^Variable:\s+(.+)$/.exec(line)?.[1]
  if (direct) return getCustomVariable(direct.trim()) ?? null

  const before = editor.currentBuffer.text.slice(0, editor.currentBuffer.point)
  const matches = [...before.matchAll(/^Variable:\s+(.+)$/gm)]
  const name = matches.at(-1)?.[1]?.trim()
  return name ? getCustomVariable(name) ?? null : null
}

async function readCustomValue(editor: Editor, variable: CustomVariable): Promise<unknown | null> {
  const initial = String(variable.value)
  const text = await editor.prompt(`Set ${variable.name}: `, initial, `customize-${variable.name}`)
  if (text == null) return null
  return parseCustomValue(variable.type, text)
}

function parseCustomValue(type: CustomType, text: string): unknown {
  if (type === "boolean") {
    const value = text.trim().toLowerCase()
    return !["nil", "false", "0", "no", "off"].includes(value)
  }
  if (type === "number") {
    const value = Number(text.trim())
    if (Number.isNaN(value)) throw new Error(`Invalid number: ${text}`)
    return value
  }
  return text
}

function customizeGroups(): string[] {
  const groups = new Set<string>(["jemacs"])
  for (const variable of listCustomVariables()) groups.add(groupForVariable(variable.name))
  return [...groups].sort()
}

function variablesForGroup(group: string): CustomVariable[] {
  if (group === "jemacs" || group === "emacs") return listCustomVariables()
  return listCustomVariables().filter(variable => groupForVariable(variable.name) === group)
}

function groupForVariable(name: string): string {
  const match = /^([^-]+)-/.exec(name)
  return match?.[1] ?? "jemacs"
}
