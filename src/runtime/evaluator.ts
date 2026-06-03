import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import type { Editor } from "../kernel/editor"

export class Evaluator {
  constructor(private readonly editor: Editor) {}

  async eval(code: string, filename = "jemacs-eval.js"): Promise<unknown> {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor
    const fn = new AsyncFunction(
      "editor",
      "console",
      "Buffer",
      "Bun",
      `// ${filename}\n${code}\n//# sourceURL=${filename}`,
    )
    return await fn(this.editor, console, Buffer, Bun)
  }

  async evalExpression(expression: string, filename = "jemacs-expression.js"): Promise<unknown> {
    return await this.eval(`return (${expression})`, filename)
  }

  async loadModule(path: string): Promise<Record<string, unknown>> {
    const full = resolve(path)
    const url = `${pathToFileURL(full).href}?t=${Date.now()}`
    return await import(url)
  }

  async loadPlugin(path: string): Promise<unknown> {
    const mod = await this.loadModule(path)
    if (typeof mod.install !== "function") {
      throw new Error(`Plugin ${path} does not export install(editor)`)
    }
    return await mod.install(this.editor)
  }
}
