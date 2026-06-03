import { resolve } from "node:path"
import { BufferModel } from "./buffer"
import { CommandRegistry, type CommandFn } from "./command"
import { Emitter } from "./events"
import { Keymap } from "./keymap"

export type EditorEvents = {
  changed: { reason: string }
  message: { text: string }
  minibuffer: { prompt: string }
}

type MinibufferRequest = {
  prompt: string
  value: string
  resolve: (value: string | null) => void
}

export class Editor {
  readonly buffers = new Map<string, BufferModel>()
  readonly commands = new CommandRegistry()
  readonly keymap = new Keymap()
  readonly events = new Emitter<EditorEvents>()
  currentBufferId: string
  minibuffer: MinibufferRequest | null = null
  running = true

  constructor() {
    const scratch = new BufferModel({ name: "*scratch*", text: "// Try: editor.message('hello from eval')\n", kind: "scratch", mode: "javascript" })
    const messages = new BufferModel({ name: "*messages*", text: "", kind: "messages" })
    this.addBuffer(scratch)
    this.addBuffer(messages)
    this.currentBufferId = scratch.id
  }

  get currentBuffer(): BufferModel {
    return this.buffers.get(this.currentBufferId) ?? [...this.buffers.values()][0]!
  }

  addBuffer(buffer: BufferModel): BufferModel {
    this.buffers.set(buffer.id, buffer)
    return buffer
  }

  switchToBuffer(idOrName: string): BufferModel {
    const found = this.buffers.get(idOrName) ?? [...this.buffers.values()].find(b => b.name === idOrName)
    if (!found) throw new Error(`No such buffer: ${idOrName}`)
    this.currentBufferId = found.id
    void this.changed("switch-buffer")
    return found
  }

  nextBuffer(): BufferModel {
    const values = [...this.buffers.values()]
    const i = values.findIndex(b => b.id === this.currentBufferId)
    const next = values[(i + 1) % values.length]!
    this.currentBufferId = next.id
    void this.changed("next-buffer")
    return next
  }

  async openFile(path: string): Promise<BufferModel> {
    const full = resolve(path)
    const existing = [...this.buffers.values()].find(b => b.path === full)
    if (existing) return this.switchToBuffer(existing.id)
    const buffer = await BufferModel.fromFile(full)
    this.addBuffer(buffer)
    this.currentBufferId = buffer.id
    await this.changed("open-file")
    return buffer
  }

  scratch(name: string, text = "", mode = "text"): BufferModel {
    const existing = [...this.buffers.values()].find(b => b.name === name)
    if (existing) {
      existing.setText(text, false)
      existing.kind = name === "*messages*" ? "messages" : "scratch"
      this.currentBufferId = existing.id
      void this.changed("scratch-update")
      return existing
    }
    const buffer = new BufferModel({ name, text, kind: "scratch", mode })
    this.addBuffer(buffer)
    this.currentBufferId = buffer.id
    void this.changed("scratch")
    return buffer
  }

  command(name: string, fn: CommandFn, description?: string): void {
    this.commands.define(name, fn, { description, interactive: true })
  }

  key(sequence: string, commandName: string): void {
    this.keymap.bind(sequence, commandName)
  }

  async run(name: string, args: string[] = []): Promise<unknown> {
    const spec = this.commands.get(name)
    if (!spec) throw new Error(`Unknown command: ${name}`)
    const result = await spec.fn({ editor: this, buffer: this.currentBuffer, args })
    await this.changed(`command:${name}`)
    return result
  }

  async prompt(prompt: string, initialValue = ""): Promise<string | null> {
    if (this.minibuffer) this.minibuffer.resolve(null)
    return await new Promise(resolve => {
      this.minibuffer = { prompt, value: initialValue, resolve }
      void this.events.emit("minibuffer", { prompt })
      void this.changed("minibuffer-open")
    })
  }

  minibufferInsert(s: string): void {
    if (!this.minibuffer) return
    this.minibuffer.value += s
    void this.changed("minibuffer-input")
  }

  minibufferBackspace(): void {
    if (!this.minibuffer) return
    this.minibuffer.value = this.minibuffer.value.slice(0, -1)
    void this.changed("minibuffer-backspace")
  }

  minibufferSubmit(): void {
    if (!this.minibuffer) return
    const request = this.minibuffer
    this.minibuffer = null
    request.resolve(request.value)
    void this.changed("minibuffer-submit")
  }

  minibufferCancel(): void {
    if (!this.minibuffer) return
    const request = this.minibuffer
    this.minibuffer = null
    request.resolve(null)
    void this.changed("minibuffer-cancel")
  }

  message(text: string): string {
    const msg = [...this.buffers.values()].find(b => b.name === "*messages*")
    if (msg) {
      msg.text += `${new Date().toISOString()}  ${text}\n`
      msg.point = msg.text.length
    }
    void this.events.emit("message", { text })
    void this.changed("message")
    return text
  }

  async changed(reason: string): Promise<void> {
    await this.events.emit("changed", { reason })
  }

  quit(): void {
    this.running = false
    void this.changed("quit")
  }
}
