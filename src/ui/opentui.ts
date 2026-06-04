import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
  type CliRenderer,
  type StyledText,
} from "@opentui/core"
import type { Editor } from "../kernel/editor"
import { isearchMatchSpan, isearchPrompt } from "../kernel/isearch"
import { listWindowLeaves, type WindowLeaf, type WindowNode } from "../kernel/window"
import { applyTheme, type Theme } from "../display/theme"
import { textWithCursor } from "./text-display"
import type { TextSpan } from "../modes/mode"

export async function startOpenTui(editor: Editor): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useKittyKeyboard: {},
  })

  const ui = new EditorUi(renderer, editor)
  ui.mount()

  renderer.keyInput.on("keypress", async (key: KeyEvent) => {
    try {
      await ui.handleKey(key)
    } catch (error) {
      editor.message(error instanceof Error ? error.stack ?? error.message : String(error))
    }
  })

  renderer.keyInput.on("paste", event => {
    const text = new TextDecoder().decode(event.bytes)
    editor.activeBuffer.insert(text)
    void editor.changed("paste")
  })

  editor.events.on("changed", () => {
    ui.render()
    if (!editor.running) {
      renderer.destroy()
    }
  })

  ui.render()
}

class EditorUi {
  private root!: BoxRenderable
  private title!: TextRenderable
  private windowsRoot!: BoxRenderable
  private minibuffer!: TextRenderable
  private echo!: TextRenderable
  private lastMessage = ""

  constructor(private readonly renderer: CliRenderer, private readonly editor: Editor) {
    editor.events.on("message", ({ text }) => {
      this.lastMessage = text
    })
  }

  mount(): void {
    this.root = new BoxRenderable(this.renderer, {
      id: "jemacs-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      borderStyle: "rounded",
      padding: 0,
    })

    this.title = new TextRenderable(this.renderer, {
      id: "jemacs-title",
      content: "Jemacs OpenTUI",
    })

    this.windowsRoot = new BoxRenderable(this.renderer, {
      id: "jemacs-windows",
      flexDirection: "column",
      flexGrow: 1,
      width: "100%",
    })

    this.minibuffer = new TextRenderable(this.renderer, {
      id: "jemacs-minibuffer",
      content: "",
    })

    this.echo = new TextRenderable(this.renderer, {
      id: "jemacs-echo",
      content: "",
    })

    this.root.add(this.title)
    this.root.add(this.windowsRoot)
    this.root.add(this.minibuffer)
    this.root.add(this.echo)
    this.renderer.root.add(this.root)
  }

  async handleKey(key: KeyEvent): Promise<void> {
    await this.editor.handleKey(key)
  }

  render(): void {
    const buffer = this.editor.currentBuffer
    const pending = this.editor.keymaps.pendingSequence()
    const depth = this.editor.minibuffer && this.editor.minibufferDepthLevel > 1
      ? ` [${this.editor.minibufferDepthLevel}]`
      : ""

    this.title.content = ` Jemacs OpenTUI — ${buffer.name}${buffer.dirty ? "*" : ""}`
    this.renderWindows(this.editor.windowLayout, contentAreaLines())
    this.minibuffer.content = this.editor.minibuffer
      ? `${depth} ${this.editor.minibuffer.prompt}${textWithCursor(this.editor.activeBuffer.text, this.editor.activeBuffer.point)}`
      : this.editor.isearch
        ? ` ${textWithCursor(isearchPrompt(this.editor.isearch), this.editor.isearch.string.length)}`
        : " "
    this.echo.content = ` ${this.lastMessage}${pending && !this.editor.minibuffer ? `  [${pending}]` : ""}`
  }

  private renderWindows(layout: WindowNode, availableLines: number): void {
    for (const child of [...this.windowsRoot.getChildren()]) {
      this.windowsRoot.remove(child.id)
    }
    this.windowsRoot.add(this.buildWindowPane(this.renderer, layout, availableLines))
  }

  private buildWindowPane(renderer: CliRenderer, layout: WindowNode, availableLines: number): BoxRenderable {
    if (layout.kind === "split") {
      const container = new BoxRenderable(renderer, {
        flexDirection: layout.direction === "vertical" ? "column" : "row",
        flexGrow: 1,
        width: "100%",
        height: "100%",
      })
      const firstLeaves = listWindowLeaves(layout.first).length
      const secondLeaves = listWindowLeaves(layout.second).length
      const totalLeaves = firstLeaves + secondLeaves
      const firstLines = layout.direction === "vertical"
        ? Math.max(3, Math.floor(availableLines * firstLeaves / totalLeaves))
        : availableLines
      const secondLines = layout.direction === "vertical"
        ? Math.max(3, availableLines - firstLines)
        : availableLines
      container.add(this.buildWindowPane(renderer, layout.first, firstLines))
      container.add(this.buildWindowPane(renderer, layout.second, secondLines))
      return container
    }
    return this.buildLeafPane(renderer, layout, availableLines)
  }

  private buildLeafPane(renderer: CliRenderer, leaf: WindowLeaf, availableLines: number): BoxRenderable {

    const pane = new BoxRenderable(renderer, {
      id: `window:${leaf.id}`,
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
      width: "100%",
      borderStyle: "single",
    })
    const body = new TextRenderable(renderer, { id: `window-body:${leaf.id}`, content: "", flexGrow: 1 })
    const modeline = new TextRenderable(renderer, { id: `window-modeline:${leaf.id}`, content: "" })
    pane.add(body)
    pane.add(modeline)

    const selected = leaf.id === this.editor.selectedWindowId
    const buffer = this.editor.buffers.get(leaf.bufferId)
    if (!buffer) {
      body.content = ""
      modeline.content = " (empty)"
      return pane
    }

    const point = selected ? buffer.point : leaf.point
    const mark = selected ? buffer.mark : null
    const dirty = buffer.dirty ? "*" : ""
    const { line, col } = pointLineCol(buffer.text, point)
    pane.border = selected
    pane.title = selected ? buffer.name : undefined

    const spans = [...this.editor.fontLock(buffer)]
    if (selected && this.editor.isearch) {
      const match = isearchMatchSpan(buffer, this.editor.isearch)
      if (match) spans.push(match)
    }
    const maxLines = Math.max(1, availableLines - 1)
    body.content = visibleStyledText(buffer.text, point, {
      mark,
      markActive: selected ? buffer.markActive : false,
      spans,
      theme: this.editor.theme,
      maxLines,
    })
    modeline.content = ` ${buffer.mode}  ${buffer.name}${dirty}  line ${line}, col ${col}${selected && buffer.mark != null ? `  mark=${buffer.mark}` : ""}`
    return pane
  }
}

function pointLineCol(text: string, point: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(0, Math.min(point, text.length)))
  const lines = before.split("\n")
  return { line: lines.length, col: lines.at(-1)!.length + 1 }
}

export function visibleText(text: string, point: number): string {
  return visibleTextRegion(text, point).visible
}

export function visibleStyledText(
  text: string,
  point: number,
  options: { mark?: number | null, markActive?: boolean, spans?: TextSpan[], theme: Theme, maxLines?: number },
): StyledText {
  const region = visibleTextRegion(text, point, options.maxLines)
  const visibleEnd = region.visibleStart + region.visible.length
  const spans = options.spans ?? []
  const mark = options.markActive === false ? null : (options.mark ?? null)
  const allSpans: TextSpan[] = mark == null || mark === point
    ? spans
    : [...spans, { start: Math.min(mark, point), end: Math.max(mark, point), face: "region" }]
  const visibleSpans = allSpans
    .filter(span => span.end > region.visibleStart && span.start < visibleEnd)
    .map(span => ({ ...span, start: Math.max(0, span.start - region.visibleStart), end: Math.min(region.visible.length, span.end - region.visibleStart) }))
  return applyTheme(region.visible, visibleSpans, options.theme)
}

export function pageScrollLines(): number {
  const rows = process.stdout.rows ?? 30
  return Math.max(1, rows - 6)
}

export function contentAreaLines(): number {
  return Math.max(3, pageScrollLines() - 1)
}

function visibleTextRegion(text: string, point: number, lineBudget = pageScrollLines()): { visible: string, visibleStart: number } {
  const cursorPoint = Math.max(0, Math.min(point, text.length))
  const withCursor = textWithCursor(text, point)
  const lines = withCursor.split("\n")
  const cursorLine = withCursor.slice(0, cursorPoint).split("\n").length - 1
  const start = Math.max(0, Math.min(cursorLine - Math.floor(lineBudget / 2), lines.length - lineBudget))
  const visibleStart = lines.slice(0, start).join("\n").length + (start > 0 ? 1 : 0)
  const visible = lines.slice(start, start + lineBudget).join("\n")
  return { visible, visibleStart }
}
