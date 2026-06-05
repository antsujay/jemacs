import type { Editor } from "../kernel/editor"
import { Keymap } from "../kernel/keymap"
import { defineMode, getMode } from "./mode"
import {
  getCustomVariable,
  getCustom,
  listCustomVariables,
  resetCustom,
  resetCustomToSaved,
  saveCustom,
  setCustom,
  type CustomType,
  type CustomVariable,
} from "../runtime/custom"
import { saveCustomFile } from "../config/load-custom"
import type { FaceAttribute } from "../runtime/faces"
import {
  faceCustomState,
  getCustomFace,
  listKnownFaceNames,
  resetFace,
  resetFaceToSaved,
  resolveThemeFace,
  saveFace,
  setFaceAttribute,
} from "../runtime/faces"
import type { FaceName } from "./mode"
import {
  getBuiltinTheme,
  listBuiltinThemeNames,
  listEnabledBuiltinThemes,
  listSavedBuiltinThemes,
  saveEnabledBuiltinThemes,
  themeSource,
} from "../themes"

export const CUSTOMIZE_VARIABLE_KEY = "jemacs-customize-variable"
export const CUSTOMIZE_THEME_KEY = "jemacs-customize-theme"
export const CUSTOMIZE_FACE_KEY = "jemacs-customize-face"

const FACE_ATTRIBUTES: FaceAttribute[] = ["family", "height", "fg", "bg", "bold", "italic", "underline"]

export function installCustomizeMode(): void {
  const keymap = new Keymap("customize-mode-map")
  for (const key of ["return", "enter", "RET"]) keymap.bind(key, "customize-set-variable")
  keymap.bind("tab", "next-line")
  keymap.bind("C-i", "next-line")
  keymap.bind("s", "customize-set-variable")
  keymap.bind("S-s", "customize-save-variable")
  keymap.bind("C-c C-c", "customize-set-variable")
  keymap.bind("C-x C-s", "customize-save-variable")
  keymap.bind("r", "customize-reset-variable")
  keymap.bind("u", "customize-reset-variable-to-saved")
  keymap.bind("d", "customize-describe-variable")
  keymap.bind("g", "customize-refresh")
  keymap.bind("n", "next-line")
  keymap.bind("p", "previous-line")
  keymap.bind("q", "quit-window")
  defineMode({ name: "customize-mode", parent: "text", keymap })

  const themeKeymap = new Keymap("custom-theme-choose-mode-map")
  for (const key of ["return", "enter", "RET", "space"]) themeKeymap.bind(key, "enable-theme")
  themeKeymap.bind("?", "describe-theme")
  themeKeymap.bind("s", "customize-save-customized")
  themeKeymap.bind("S-s", "customize-save-customized")
  themeKeymap.bind("C-x C-s", "customize-save-customized")
  themeKeymap.bind("g", "customize-refresh")
  themeKeymap.bind("n", "next-line")
  themeKeymap.bind("p", "previous-line")
  themeKeymap.bind("q", "quit-window")
  defineMode({ name: "custom-theme-choose-mode", parent: "text", keymap: themeKeymap })

  const faceKeymap = new Keymap("customize-face-mode-map")
  for (const key of ["return", "enter", "RET"]) faceKeymap.bind(key, "customize-set-face")
  faceKeymap.bind("s", "customize-set-face")
  faceKeymap.bind("S-s", "customize-save-face")
  faceKeymap.bind("C-c C-c", "customize-set-face")
  faceKeymap.bind("C-x C-s", "customize-save-face")
  faceKeymap.bind("r", "customize-reset-face")
  faceKeymap.bind("u", "customize-reset-face-to-saved")
  faceKeymap.bind("g", "customize-refresh")
  faceKeymap.bind("n", "next-line")
  faceKeymap.bind("p", "previous-line")
  faceKeymap.bind("q", "quit-window")
  defineMode({ name: "customize-face-mode", parent: "text", keymap: faceKeymap })
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

  editor.command("customize-group-other-window", async ctx => {
    await ctx.editor.run("customize-group", ctx.args)
    showCurrentBufferInOtherWindow(ctx.editor)
  }, "Customize GROUP in another window.")

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

  editor.command("customize-variable-other-window", async ctx => {
    await ctx.editor.run("customize-variable", ctx.args)
    showCurrentBufferInOtherWindow(ctx.editor)
  }, "Customize SYMBOL in another window.")

  editor.command("customize-option", async ctx => {
    await ctx.editor.run("customize-variable", ctx.args)
  }, "Customize SYMBOL, which must be a user option.")

  editor.command("customize-option-other-window", async ctx => {
    await ctx.editor.run("customize-variable-other-window", ctx.args)
  }, "Customize SYMBOL in another window.")

  editor.command("customize-set-variable", async ({ editor, args }) => {
    await customizeSetVariable(editor, args, false)
  }, "Set the default for VARIABLE to VALUE.")

  editor.command("customize-set-value", async ({ editor, args }) => {
    await customizeSetVariable(editor, args, false)
  }, "Set VARIABLE to VALUE.")

  editor.command("customize-save-variable", async ({ editor, args }) => {
    await customizeSetVariable(editor, args, true)
  }, "Set VARIABLE to VALUE and save it for future sessions.")

  editor.command("customize-reset-variable", ({ editor, args }) => {
    const name = args[0] ?? customizeVariableAtPoint(editor)?.name
    if (!name) return editor.message("No customizable option at point")
    if (!resetCustom(name)) return editor.message(`Cannot reset ${name}`)
    editor.message(`Reset ${name} to standard value`)
    refreshCustomizeBuffer(editor)
  }, "Reset VARIABLE to its standard value, erasing any customization.")

  editor.command("customize-reset-variable-to-saved", ({ editor, args }) => {
    const name = args[0] ?? customizeVariableAtPoint(editor)?.name
    if (!name) return editor.message("No customizable option at point")
    if (!resetCustomToSaved(name)) return editor.message(`No saved value for ${name}`)
    editor.message(`Reset ${name} to saved value`)
    refreshCustomizeBuffer(editor)
  }, "Reset VARIABLE to its saved value.")

  editor.command("customize-describe-variable", async ({ editor, args }) => {
    const name = args[0] ?? customizeVariableAtPoint(editor)?.name
    if (!name) return editor.message("No customizable option at point")
    await editor.run("describe-variable", [name])
  }, "Describe the customizable option at point.")

  editor.command("customize-refresh", ({ editor }) => {
    refreshCustomizeBuffer(editor)
  }, "Redisplay the current Customize buffer.")

  editor.command("customize-save-customized", async ({ editor }) => {
    const variables = listCustomVariables().filter(variable => variable.customized)
    for (const variable of variables) saveCustom(variable.name)
    saveEnabledBuiltinThemes()
    await saveCustomFile()
    const themes = listSavedBuiltinThemes().length
    editor.message(`Saved ${variables.length} customized option${variables.length === 1 ? "" : "s"} and ${themes} theme${themes === 1 ? "" : "s"} to ~/.jemacs/custom.ts`)
    refreshCustomizeBuffer(editor)
  }, "Save all user options which have been set in this session.")

  editor.command("customize-set-face", async ({ editor, args }) => {
    await customizeSetFace(editor, args, false)
  }, "Set a face attribute for the current session.")

  editor.command("customize-save-face", async ({ editor, args }) => {
    await customizeSetFace(editor, args, true)
  }, "Set a face attribute and save it for future sessions.")

  editor.command("customize-reset-face", ({ editor, args }) => {
    const name = args[0] ?? customizeFaceAtPoint(editor)?.name
    if (!name) {
      editor.message("No face at point")
      return
    }
    if (!resetFace(name)) {
      editor.message(`Unknown face: ${name}`)
      return
    }
    editor.refreshComposedTheme()
    editor.message(`Reset face ${name}`)
    refreshCustomizeBuffer(editor)
  }, "Reset FACE to its standard definition.")

  editor.command("customize-reset-face-to-saved", ({ editor, args }) => {
    const name = args[0] ?? customizeFaceAtPoint(editor)?.name
    if (!name) {
      editor.message("No face at point")
      return
    }
    if (!resetFaceToSaved(name)) {
      editor.message(`No saved value for face ${name}`)
      return
    }
    editor.refreshComposedTheme()
    editor.message(`Reset face ${name} to saved value`)
    refreshCustomizeBuffer(editor)
  }, "Reset FACE to its saved customization.")

  editor.command("customize-unsaved", ({ editor }) => {
    showCustomizeBuffer(editor, listCustomVariables().filter(isUnsavedCustom), "Customize Unsaved Options")
  }, "Customize all options set in this session but not saved.")

  editor.command("customize-saved", ({ editor }) => {
    showCustomizeBuffer(editor, listCustomVariables().filter(variable => variable.savedValue !== undefined), "Customize Saved Options")
  }, "Customize all saved options.")

  editor.command("customize-rogue", ({ editor }) => {
    showCustomizeBuffer(editor, listCustomVariables().filter(variable => variable.patched), "Customize Rogue Options")
  }, "Customize user variables modified outside Customize.")

  editor.command("customize-changed", ({ editor }) => {
    showCustomizeBuffer(editor, listCustomVariables(), "Customize Changed Options")
  }, "Customize settings whose meanings have changed.")

  editor.command("customize-changed-options", async ctx => {
    await ctx.editor.run("customize-changed", ctx.args)
  }, "Customize settings whose meanings have changed.")

  editor.command("customize-mode", async ({ editor, args }) => {
    const mode = args[0] ?? await editor.completingRead("Customize mode: ", {
      collection: customizeGroups(),
      history: "customize-mode",
      initialValue: editor.currentBuffer.mode,
    })
    if (!mode) return
    const group = mode.endsWith("-mode") ? mode.slice(0, -"mode".length).replace(/-$/, "") : mode
    showCustomizeBuffer(editor, variablesForGroup(group), `Customize Mode: ${mode}`)
  }, "Customize options related to a major or minor mode.")

  editor.command("customize-apropos", async ({ editor, args }) => {
    await customizeApropos(editor, args, "all")
  }, "Customize loaded options, faces and groups matching PATTERN.")

  editor.command("customize-apropos-options", async ({ editor, args }) => {
    await customizeApropos(editor, args, "options")
  }, "Customize all loaded customizable options matching REGEXP.")

  editor.command("customize-apropos-groups", async ({ editor, args }) => {
    await customizeApropos(editor, args, "groups")
  }, "Customize all loaded groups matching REGEXP.")

  editor.command("customize-apropos-faces", async ({ editor, args }) => {
    await customizeApropos(editor, args, "faces")
  }, "Customize all loaded faces matching REGEXP.")

  editor.command("customize-face", async ({ editor, args }) => {
    await showCustomizeFaces(editor, args[0])
  }, "Customize FACE, which should be a face name or nil.")

  editor.command("customize-face-other-window", async ctx => {
    await ctx.editor.run("customize-face", ctx.args)
    showCurrentBufferInOtherWindow(ctx.editor)
  }, "Show customization buffer for FACE in other window.")

  editor.command("customize-icon", ({ editor, args }) => {
    editor.message(args[0] ? `No customizable icon named ${args[0]}` : "No customizable icons are registered")
  }, "Customize ICON.")

  editor.command("customize-browse", async ({ editor, args }) => {
    const group = args[0]
    const groups = customizeGroups().filter(candidate => !group || candidate === group || candidate.includes(group))
    const lines = ["Customize Browse", "", ...groups.map(candidate => `Group: ${candidate}`)]
    editor.scratch("*Customize Browse*", lines.join("\n"), "customize-mode")
  }, "Create a tree browser for the customize hierarchy.")

  editor.command("customize-themes", ({ editor }) => {
    showCustomizeThemesBuffer(editor)
  }, "Display a selectable list of Custom themes.")

  editor.command("custom-theme-visit-theme", ({ editor, args }) => {
    const name = args[0]
    if (!name || !getBuiltinTheme(name)) {
      editor.message(name ? `Unknown theme: ${name}` : "No theme specified")
      return
    }
    showCustomizeThemesBuffer(editor, [name], `Custom Theme: ${name}`)
  }, "Set up a Custom buffer to edit custom theme THEME.")

  editor.command("customize-create-theme", ({ editor, args }) => {
    const name = args[0]
    if (!name) {
      editor.message("No theme specified")
      return
    }
    if (!getBuiltinTheme(name)) {
      editor.message(`Unknown theme: ${name}`)
      return
    }
    showCustomizeThemesBuffer(editor, [name], `Custom Theme: ${name}`)
  }, "Create or edit a custom theme.")

  editor.command("widget-browse", ({ editor, args }) => {
    showWidgetBrowser(editor, args[0])
  }, "Create a widget browser for WIDGET.")

  editor.command("widget-browse-at", ({ editor }) => {
    const variable = customizeVariableAtPoint(editor)
    const theme = customizeThemeAtPoint(editor)
    showWidgetBrowser(editor, variable?.name ?? theme ?? "point")
  }, "Create a widget browser for the widget at point.")

  editor.command("widget-browse-other-window", ({ editor, args }) => {
    showWidgetBrowser(editor, args[0])
    showCurrentBufferInOtherWindow(editor)
  }, "Create a widget browser for WIDGET in another window.")

  editor.command("widget-minor-mode", ({ editor }) => {
    editor.message("Widget minor mode is represented by Customize keymaps")
  }, "Minor mode for traversing widgets.")
}

function showCustomizeBuffer(editor: Editor, variables: CustomVariable[], title: string): void {
  const body = formatCustomizeBuffer(title, variables)
  const buffer = editor.scratch("*Customize*", body, "customize-mode")
  buffer.readOnly = true
  buffer.locals.set(CUSTOMIZE_VARIABLE_KEY, variables.map(variable => variable.name))
  buffer.locals.delete(CUSTOMIZE_THEME_KEY)
  buffer.point = body.indexOf("Variable: ")
  if (buffer.point < 0) buffer.point = 0
}

function refreshCustomizeBuffer(editor: Editor): void {
  const faces = editor.currentBuffer.locals.get(CUSTOMIZE_FACE_KEY) as string[] | undefined
  if (faces) {
    const title = editor.currentBuffer.text.split("\n", 1)[0] || "Customize Faces"
    showCustomizeFacesBuffer(editor, faces, title)
    return
  }
  const themes = editor.currentBuffer.locals.get(CUSTOMIZE_THEME_KEY) as string[] | undefined
  if (themes) {
    const title = editor.currentBuffer.text.split("\n", 1)[0] || "Custom Themes"
    showCustomizeThemesBuffer(editor, themes, title)
    return
  }
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
    "Keys: RET/s set, S save, r reset, u reset-saved, d describe, g refresh, n/p move, q quit",
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

function showCustomizeThemesBuffer(editor: Editor, themeNames = listBuiltinThemeNames(), title = "Custom Themes"): void {
  const body = formatCustomizeThemesBuffer(title, themeNames)
  const buffer = editor.scratch("*Custom Themes*", body, "custom-theme-choose-mode")
  buffer.readOnly = true
  buffer.locals.set(CUSTOMIZE_THEME_KEY, themeNames)
  buffer.locals.delete(CUSTOMIZE_VARIABLE_KEY)
  buffer.point = body.indexOf("Theme: ")
  if (buffer.point < 0) buffer.point = 0
}

function formatCustomizeThemesBuffer(title: string, themeNames: string[]): string {
  const enabled = new Set(listEnabledBuiltinThemes())
  const saved = new Set(listSavedBuiltinThemes())
  const lines = [
    title,
    "",
    "Keys: RET/space toggle, S save selected themes, g refresh, n/p move, q quit",
    "",
  ]
  if (!themeNames.length) {
    lines.push("No Custom themes match.")
    return lines.join("\n")
  }
  for (const name of themeNames) {
    const state = enabled.has(name) ? "enabled" : "disabled"
    const savedState = saved.has(name) ? ", saved" : ""
    lines.push(
      `Theme: ${name} [${enabled.has(name) ? "X" : " "}]`,
      `  State: ${state}${savedState}`,
      `  Source: ${themeSource(name)}`,
      "",
    )
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

function customizeThemeAtPoint(editor: Editor): string | null {
  const line = editor.currentBuffer.lineBoundsAt().text
  const direct = /^Theme:\s+(.+?)\s+\[/.exec(line)?.[1]
  if (direct && getBuiltinTheme(direct.trim())) return direct.trim()

  const before = editor.currentBuffer.text.slice(0, editor.currentBuffer.point)
  const matches = [...before.matchAll(/^Theme:\s+(.+?)\s+\[/gm)]
  const name = matches.at(-1)?.[1]?.trim()
  return name && getBuiltinTheme(name) ? name : null
}

async function customizeSetVariable(editor: Editor, args: string[], save: boolean): Promise<void> {
  const variableAtPoint = customizeVariableAtPoint(editor)
  const name = args[0] ?? variableAtPoint?.name ?? await editor.completingRead(save ? "Customize save variable: " : "Customize set variable: ", {
    collection: listCustomVariables().map(variable => variable.name),
    history: "variable",
  })
  if (!name) return
  const variable = getCustomVariable(name)
  if (!variable) {
    editor.message(`No user option named ${name}`)
    return
  }
  const raw = args.length >= 2 ? args[1]! : await editor.prompt(`Set ${name}: `, formatCustomValue(variable.type, getCustom(name)), `customize-${name}`)
  if (raw == null) return
  const value = parseCustomValue(variable.type, raw)
  if (save) {
    saveCustom(name, value)
    editor.message(`Saved ${name}`)
  } else {
    setCustom(name, value)
    editor.message(`Set ${name}`)
  }
  refreshCustomizeBuffer(editor)
}

async function customizeApropos(editor: Editor, args: string[], type: "all" | "options" | "groups" | "faces"): Promise<void> {
  const pattern = args[0] ?? await editor.prompt("Customize apropos: ", "", "customize-apropos")
  if (!pattern) return
  const re = new RegExp(pattern, "i")
  if (type === "groups") {
    const groups = customizeGroups().filter(group => re.test(group))
    const lines = ["Customize Apropos Groups", "", ...groups.map(group => `Group: ${group}`)]
    editor.scratch("*Customize Apropos*", lines.join("\n") || "No groups match.", "customize-mode")
    return
  }
  if (type === "faces") {
    await showCustomizeFaces(editor, pattern)
    return
  }
  const variables = listCustomVariables().filter(variable =>
    re.test(variable.name) || re.test(variable.doc ?? "") || re.test(groupForVariable(variable.name))
  )
  showCustomizeBuffer(editor, variables, `Customize Apropos${type === "options" ? " Options" : ""}: ${pattern}`)
}

async function showCustomizeFaces(editor: Editor, pattern?: string): Promise<void> {
  const names = listKnownFaceNames()
  const re = pattern ? new RegExp(pattern, "i") : null
  const filtered = re ? names.filter(name => re.test(name)) : names
  const title = pattern ? `Customize Faces: ${pattern}` : "Customize Faces"
  showCustomizeFacesBuffer(editor, filtered, title)
}

function showCustomizeFacesBuffer(editor: Editor, faceNames: string[], title: string): void {
  const body = formatCustomizeFacesBuffer(editor, title, faceNames)
  const buffer = editor.scratch("*Customize Faces*", body, "customize-face-mode")
  buffer.readOnly = true
  buffer.locals.set(CUSTOMIZE_FACE_KEY, faceNames)
  buffer.locals.delete(CUSTOMIZE_VARIABLE_KEY)
  buffer.locals.delete(CUSTOMIZE_THEME_KEY)
  buffer.point = body.indexOf("Face: ")
  if (buffer.point < 0) buffer.point = 0
}

function formatCustomizeFacesBuffer(editor: Editor, title: string, faceNames: string[]): string {
  const lines = [
    title,
    "",
    "Keys: RET/s set attribute, S save, r reset, u reset-saved, g refresh, n/p move, q quit",
    "",
  ]
  if (!faceNames.length) {
    lines.push("No faces match.")
    return lines.join("\n")
  }
  for (const name of faceNames) {
    const resolved = resolveThemeFace(editor.theme, name as FaceName)
    lines.push(`Face: ${name}`, `  State: ${faceCustomState(name)}`)
    for (const attr of FACE_ATTRIBUTES) {
      const value = resolved?.[attr]
      if (value != null) lines.push(`  ${attr}: ${JSON.stringify(value)}`)
    }
    const doc = getCustomFace(name)?.doc
    if (doc) lines.push(`  ${doc}`)
    lines.push("")
  }
  return lines.join("\n")
}

function customizeFaceAtPoint(editor: Editor): { name: string } | null {
  const line = editor.currentBuffer.lineBoundsAt().text
  const direct = /^Face:\s+(.+)$/.exec(line)?.[1]
  if (direct) return { name: direct.trim() }

  const before = editor.currentBuffer.text.slice(0, editor.currentBuffer.point)
  const matches = [...before.matchAll(/^Face:\s+(.+)$/gm)]
  const name = matches.at(-1)?.[1]?.trim()
  return name ? { name } : null
}

async function customizeSetFace(editor: Editor, args: string[], save: boolean): Promise<void> {
  const faceAtPoint = customizeFaceAtPoint(editor)
  const name = args[0] ?? faceAtPoint?.name ?? await editor.completingRead("Customize face: ", {
    collection: listKnownFaceNames(),
    history: "customize-face",
  })
  if (!name) return
  const attribute = (args[1] ?? await editor.completingRead("Face attribute: ", {
    collection: FACE_ATTRIBUTES,
    history: "face-attribute",
  })) as FaceAttribute | null
  if (!attribute || !FACE_ATTRIBUTES.includes(attribute)) {
    editor.message("No face attribute specified")
    return
  }
  const current = resolveThemeFace(editor.theme, name as FaceName)?.[attribute]
  const raw = args[2] ?? await editor.prompt(`Set ${name} ${attribute}: `, current == null ? "" : JSON.stringify(current), `customize-face-${name}-${attribute}`)
  if (raw == null) return
  const value = parseFaceAttribute(attribute, raw)
  setFaceAttribute(name, attribute, value)
  if (save) {
    saveFace(name)
    await saveCustomFile()
    editor.message(`Saved ${name} ${attribute}`)
  } else {
    editor.message(`Set ${name} ${attribute}`)
  }
  editor.refreshComposedTheme()
  refreshCustomizeBuffer(editor)
}

function parseFaceAttribute(attribute: FaceAttribute, text: string): unknown {
  if (attribute === "bold" || attribute === "italic" || attribute === "underline") {
    const value = text.trim().toLowerCase()
    return !["nil", "false", "0", "no", "off"].includes(value)
  }
  if (attribute === "height") {
    const value = Number(text.trim())
    if (Number.isNaN(value)) throw new Error(`Invalid height: ${text}`)
    return value
  }
  if (text.startsWith("\"") || text.startsWith("'")) {
    try { return JSON.parse(text.replace(/^'/, "\"").replace(/'$/, "\"")) } catch { /* fall through */ }
  }
  return text.trim()
}

function formatCustomValue(type: CustomType, value: unknown): string {
  return type === "sexp" ? JSON.stringify(value) : String(value)
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
  if (type === "sexp") {
    try { return JSON.parse(text) } catch { throw new Error(`Invalid JSON: ${text}`) }
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

function isUnsavedCustom(variable: CustomVariable): boolean {
  if (!variable.customized) return false
  if (variable.savedValue === undefined) return true
  return !Object.is(variable.value, variable.savedValue)
}

function showCurrentBufferInOtherWindow(editor: Editor): void {
  const current = editor.currentBuffer
  editor.displayBufferInOtherWindow(current.id)
}

function showWidgetBrowser(editor: Editor, widget = "widget"): void {
  const variable = widget ? getCustomVariable(widget) : null
  const theme = widget ? getBuiltinTheme(widget) : null
  const lines = [
    "Widget Browser",
    "",
    `Widget: ${widget}`,
    variable ? `Type: ${variable.type}` : theme ? `Type: custom-theme (${themeSource(widget)})` : "Type: unknown",
  ]
  editor.scratch("*Widget Browser*", lines.join("\n"), "help")
}
