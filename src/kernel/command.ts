import type { Editor } from "./editor"
import type { BufferModel } from "./buffer"

export type CommandContext = {
  editor: Editor
  buffer: BufferModel
  args: string[]
  prefixArgument: number | null
}

export type CommandFn = (ctx: CommandContext) => unknown | Promise<unknown>

export type CommandSpec = {
  name: string
  description?: string
  interactive?: boolean
  fn: CommandFn
}

export class CommandRegistry {
  private commands = new Map<string, CommandSpec>()

  define(name: string, fn: CommandFn, options: Omit<CommandSpec, "name" | "fn"> = {}): void {
    this.commands.set(name, { name, fn, ...options })
  }

  get(name: string): CommandSpec | undefined {
    return this.commands.get(name)
  }

  names(): string[] {
    return [...this.commands.keys()].sort()
  }

  entries(): CommandSpec[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}
