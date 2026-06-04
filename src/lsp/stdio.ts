import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { BufferModel } from "../kernel/buffer"
import { spawnProcess, whichExecutable } from "../platform/runtime"
import type { LspConnection } from "./client"

/** Port of `lsp-stdio-connection` from lsp-mode.el. */
export function stdioConnection(
  command: string[] | ((cwd: string) => string[]),
  testCommand?: (buffer?: BufferModel) => boolean,
): LspConnection {
  return {
    connect({ onData, onExit, serverId, cwd }) {
      const argv = typeof command === "function" ? command(cwd) : command
      const proc = spawnProcess({
        cmd: argv,
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = proc.stdout
      if (!stdout) throw new Error(`Failed to start ${serverId}: no stdout`)
      void (async () => {
        const reader = stdout.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (value) onData(decoder.decode(value))
          }
        } finally {
          reader.releaseLock()
        }
      })()
      proc.exited.then(code => onExit(code)).catch(() => onExit(null))
      return {
        proc: { kill: () => proc.kill() },
        send(message: string) {
          proc.stdin?.write(message)
        },
      }
    },
    test:
      testCommand
      ?? (buffer => {
        const cwd = buffer?.path ? dirname(resolve(buffer.path)) : process.cwd()
        const argv = typeof command === "function" ? command(cwd) : command
        const bin = argv[0]!
        return existsSync(bin) || whichExecutable(bin) != null
      }),
  }
}
