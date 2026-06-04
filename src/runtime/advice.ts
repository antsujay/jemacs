import type { CommandContext, CommandFn } from "../kernel/command"

export type CommandAdvice = {
  before?: (ctx: CommandContext) => void | Promise<void>
  after?: (ctx: CommandContext) => void | Promise<void>
}

const adviceByCommand = new Map<string, CommandAdvice[]>()

export function addAdvice(commandName: string, advice: CommandAdvice): void {
  const list = adviceByCommand.get(commandName) ?? []
  list.push(advice)
  adviceByCommand.set(commandName, list)
}

export function clearAdvice(commandName?: string): void {
  if (commandName) adviceByCommand.delete(commandName)
  else adviceByCommand.clear()
}

export async function invokeWithAdvice(commandName: string, fn: CommandFn, ctx: CommandContext): Promise<unknown> {
  const list = adviceByCommand.get(commandName) ?? []
  for (const hook of list) await hook.before?.(ctx)
  const result = await fn(ctx)
  for (const hook of list) await hook.after?.(ctx)
  return result
}
