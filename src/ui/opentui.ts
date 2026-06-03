import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
  type CliRenderer,
} from "@opentui/core"
import type { Editor } from "../kernel/editor"
import { applyTheme, type Theme } from "../display/theme"
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
    editor.currentBuffer.insert(text)
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
  private body!: TextRenderable
  private modeline!: TextRenderable
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

    this.body = new TextRenderable(this.renderer, {
      id: "jemacs-body",
      content: "",
      flexGrow: 1,
    })

    this.modeline = new TextRenderable(this.renderer, {
      id: "jemacs-modeline",
      content: "",
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
    this.root.add(this.body)
    this.root.add(this.modeline)
    this.root.add(this.minibuffer)
    this.root.add(this.echo)
    this.renderer.root.add(this.root)
  }

  async handleKey(key: KeyEvent): Promise<void> {
    await this.editor.handleKey(key)
  }

  render(): void {
    const buffer = this.editor.currentBuffer
    const { line, col } = buffer.lineCol()
    const pending = this.editor.keymaps.pendingSequence()
    const mark = buffer.mark == null ? "" : ` mark=${buffer.mark}`
    const dirty = buffer.dirty ? "*" : ""

    this.title.content = ` Jemacs OpenTUI — ${buffer.name}${dirty}`
    this.body.content = visibleText(buffer.text, buffer.point, this.editor.fontLock(buffer), this.editor.theme)
    this.modeline.content = ` ${buffer.mode}  ${buffer.name}${dirty}  line ${line}, col ${col}  point ${buffer.point}${mark}${pending ? `  [${pending}]` : ""}`
    this.minibuffer.content = this.editor.minibuffer
      ? ` ${this.editor.minibuffer.prompt}${this.editor.activeBuffer.text}█`
      : " "
    this.echo.content = ` ${this.lastMessage}`
  }
}

export function visibleText(text: string, point: number, spans: TextSpan[] = [], theme?: Theme): string {
  const cursorPoint = Math.max(0, Math.min(point, text.length))
  const underCursor = text[cursorPoint]
  const withCursor = underCursor && underCursor !== "\n"
    ? text.slice(0, cursorPoint) + "█" + text.slice(cursorPoint + 1)
    : text.slice(0, cursorPoint) + "█" + text.slice(cursorPoint)
  const lines = withCursor.split("\n")
  const rows = process.stdout.rows ?? 30
  const maxLines = Math.max(1, rows - 6)
  const cursorLine = withCursor.slice(0, cursorPoint).split("\n").length - 1
  const start = Math.max(0, Math.min(cursorLine - Math.floor(maxLines / 2), lines.length - maxLines))
  const visibleStart = lines.slice(0, start).join("\n").length + (start > 0 ? 1 : 0)
  const visible = lines.slice(start, start + maxLines).join("\n")
  if (!theme) return visible
  const visibleEnd = visibleStart + visible.length
  const visibleSpans = spans
    .filter(span => span.end > visibleStart && span.start < visibleEnd)
    .map(span => ({ ...span, start: Math.max(0, span.start - visibleStart), end: Math.min(visible.length, span.end - visibleStart) }))
  return applyTheme(visible, visibleSpans, theme)
}
