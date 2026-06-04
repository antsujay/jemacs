import type { Editor } from "../kernel/editor"
import type { BufferModel } from "../kernel/buffer"
import { xrefPushMark } from "./history"
import { bufferSearchDefinitions, jumpToXrefLocation } from "./jump"
import { formatXrefLocation, type XrefLocation } from "./types"

export async function xrefFindDefinitionsCommand(
  editor: Editor,
  options: { identifier?: string; prefixArgument?: number | null },
): Promise<void> {
  const buffer = editor.currentBuffer
  const atPoint = buffer.symbolBoundsAt().text
  let identifier = options.identifier

  if (identifier == null) {
    const shouldPrompt = options.prefixArgument != null || !atPoint
    if (shouldPrompt) {
      const prompt = atPoint ? `Find definitions of (default ${atPoint}): ` : "Find definitions of: "
      identifier = await editor.completingRead(prompt, {
        history: "xref-identifier",
        initialValue: atPoint,
      }) ?? atPoint
    } else {
      identifier = atPoint
    }
  }

  if (!identifier) {
    editor.message("No identifier at point")
    return
  }

  const locations = await findDefinitions(editor, buffer, identifier)
  if (!locations.length) {
    editor.message(`No definitions found for: ${identifier}`)
    return
  }

  xrefPushMark(editor, buffer)

  if (locations.length === 1) {
    await jumpToXrefLocation(editor, locations[0]!)
    editor.message(`Found definition of ${identifier}`)
    return
  }

  const choices = locations.map(loc => formatXrefLocation(loc))
  const body = locations.map((loc, i) => `${choices[i]!}${loc.summary ? `  ${loc.summary}` : ""}`).join("\n")
  editor.scratch("*xref*", body, "text")

  const choice = await editor.completingRead(`Find definitions of ${identifier}: `, {
    collection: choices,
    history: "xref-definition",
    initialValue: choices[0],
  })
  if (!choice) return
  const index = choices.indexOf(choice)
  await jumpToXrefLocation(editor, locations[index >= 0 ? index : 0]!)
}

async function findDefinitions(
  editor: Editor,
  buffer: BufferModel,
  identifier: string,
): Promise<XrefLocation[]> {
  const lspLocations = await editor.lsp?.definitionsAtPoint(buffer) ?? []
  if (lspLocations.length) return lspLocations
  return bufferSearchDefinitions(buffer, identifier)
}
