import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
  type CliRenderer,
} from "@opentui/core"
import type { Editor } from "../kernel/editor"
import { isPrintable, keyToken } from "../kernel/keymap"

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
    if (key.ctrl && key.name === "g") {
      await this.editor.run("keyboard-quit")
      return
    }

    if (this.editor.minibuffer) {
      await this.handleMinibufferKey(key)
      return
    }

    if (key.ctrl && key.name === "c") {
      const fed = this.editor.keymap.feed(key)
      if (fed.status === "matched") await this.editor.run(fed.command)
      else await this.editor.changed("key-prefix")
      return
    }

    if (key.ctrl || key.meta) {
      const fed = this.editor.keymap.feed(key)
      if (fed.status === "matched") await this.editor.run(fed.command)
      else if (fed.status === "pending") await this.editor.changed("key-prefix")
      else this.editor.message(`Unbound key: ${keyToken(key)}`)
      return
    }

    const buffer = this.editor.currentBuffer
    switch (key.name) {
      case "left":
        buffer.move(-1)
        break
      case "right":
        buffer.move(1)
        break
      case "up":
        buffer.moveLine(-1)
        break
      case "down":
        buffer.moveLine(1)
        break
      case "backspace":
        buffer.deleteBackward()
        break
      case "delete":
        buffer.deleteForward()
        break
      case "escape":
        this.editor.keymap.clearPending()
        buffer.clearMark()
        this.editor.message("Canceled")
        break
      default:
        if (isPrintable(key)) buffer.insert(key.sequence ?? "")
        else return
    }

    await this.editor.changed(`key:${key.name}`)
  }

  private async handleMinibufferKey(key: KeyEvent): Promise<void> {
    if (key.ctrl && key.name === "g") {
      await this.editor.run("keyboard-quit")
      return
    }

    switch (key.name) {
      case "return":
        this.editor.minibufferSubmit()
        break
      case "escape":
        this.editor.minibufferCancel()
        break
      case "backspace":
        this.editor.minibufferBackspace()
        break
      default:
        if (isPrintable(key)) this.editor.minibufferInsert(key.sequence ?? "")
    }
    await this.editor.changed("minibuffer-key")
  }

  render(): void {
    const buffer = this.editor.currentBuffer
    const { line, col } = buffer.lineCol()
    const pending = this.editor.keymap.pendingSequence()
    const mark = buffer.mark == null ? "" : ` mark=${buffer.mark}`
    const dirty = buffer.dirty ? "*" : ""

    this.title.content = ` Jemacs OpenTUI — ${buffer.name}${dirty}`
    this.body.content = visibleText(buffer.text, buffer.point)
    this.modeline.content = ` ${buffer.mode}  ${buffer.name}${dirty}  line ${line}, col ${col}  point ${buffer.point}${mark}${pending ? `  [${pending}]` : ""}`
    this.minibuffer.content = this.editor.minibuffer
      ? ` ${this.editor.minibuffer.prompt}${this.editor.minibuffer.value}█`
      : " "
    this.echo.content = ` ${this.lastMessage}`
  }
}

function visibleText(text: string, point: number): string {
  const withCursor = text.slice(0, point) + "█" + text.slice(point)
  const lines = withCursor.split("\n")
  const maxLines = Math.max(1, process.stdout.rows - 6)
  const cursorLine = withCursor.slice(0, point).split("\n").length - 1
  const start = Math.max(0, Math.min(cursorLine - Math.floor(maxLines / 2), lines.length - maxLines))
  return lines.slice(start, start + maxLines).join("\n")
}
