import { spawn as nodeSpawn } from "node:child_process"
import { constants, existsSync } from "node:fs"
import { access, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Readable } from "node:stream"

export type StatLike = { mode: number; size: number; mtime: number }

/** Swappable backend for the functions below. The browser shadow bundle
 *  installs a stub that throws (phase-5); phase-6 installs the manifest+CAS
 *  backed impl (shadow/DESIGN.md §Filesystem replica). When unset, the
 *  Bun/Node implementations in this file are used.
 *
 *  `stat`/`readdir` are optional: the Node default doesn't provide them (dired
 *  etc. import `node:fs/promises` directly), but the remote runtime does so
 *  navigation can be served from the manifest without a node:fs dependency. */
export type PlatformRuntime = {
  readFileText(path: string): Promise<string>
  writeFileText(path: string, text: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  spawnProcess(options: SpawnOptions): SpawnHandle
  whichExecutable(name: string): string | null
  stat?(path: string): Promise<StatLike | null>
  readdir?(dir: string): Promise<string[]>
}

let override: Partial<PlatformRuntime> | undefined

export function setPlatformRuntime(impl: Partial<PlatformRuntime> | undefined): void {
  override = impl
}

/** Current override, for save/restore around a scoped install (attachShadow). */
export function getPlatformRuntime(): Partial<PlatformRuntime> | undefined {
  return override
}

export type SpawnOptions = {
  cmd: string[]
  cwd?: string
  stdin?: "pipe" | "ignore"
  stdout?: "pipe" | "ignore"
  stderr?: "pipe" | "ignore"
}

export type SpawnHandle = {
  stdin: { write(chunk: string): void; end(): void } | null
  stdout: ReadableStream<Uint8Array> | null
  stderr: ReadableStream<Uint8Array> | null
  exited: Promise<number | null>
  kill(): void
}

function nodeReadableToWeb(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      stream.on("data", chunk => {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk
        controller.enqueue(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
      })
      stream.on("end", () => controller.close())
      stream.on("error", error => controller.error(error))
    },
    cancel() {
      stream.destroy()
    },
  })
}

export function whichExecutable(name: string): string | null {
  if (override?.whichExecutable) return override.whichExecutable(name)
  if (name.includes("/")) return existsSync(name) ? name : null
  const pathEnv = process.env.PATH ?? ""
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue
    const full = join(dir, name)
    if (existsSync(full)) return full
  }
  return null
}

export async function fileExists(path: string): Promise<boolean> {
  if (override?.fileExists) return override.fileExists(path)
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function readFileText(path: string): Promise<string> {
  if (override?.readFileText) return override.readFileText(path)
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return ""
    throw error
  }
}

export async function writeFileText(path: string, text: string): Promise<void> {
  if (override?.writeFileText) return override.writeFileText(path, text)
  await writeFile(path, text, "utf8")
}

/** Spawn a subprocess in Bun or Node (Electron main uses Node). */
export function spawnProcess(options: SpawnOptions): SpawnHandle {
  if (override?.spawnProcess) return override.spawnProcess(options)
  if (typeof Bun !== "undefined") {
    const proc = Bun.spawn({
      cmd: options.cmd,
      cwd: options.cwd,
      stdin: options.stdin ?? "ignore",
      stdout: options.stdout ?? "ignore",
      stderr: options.stderr ?? "ignore",
    })
    return {
      stdin: proc.stdin
        ? { write: chunk => proc.stdin!.write(chunk), end: () => proc.stdin!.end() }
        : null,
      stdout: proc.stdout ?? null,
      stderr: proc.stderr ?? null,
      exited: proc.exited.then(code => code),
      kill: () => proc.kill(),
    }
  }

  const proc = nodeSpawn(options.cmd[0]!, options.cmd.slice(1), {
    cwd: options.cwd,
    stdio: [
      options.stdin === "pipe" ? "pipe" : "ignore",
      options.stdout === "pipe" ? "pipe" : "ignore",
      options.stderr === "pipe" ? "pipe" : "ignore",
    ],
  })

  return {
    stdin: proc.stdin
      ? { write: chunk => proc.stdin!.write(chunk), end: () => proc.stdin!.end() }
      : null,
    stdout: proc.stdout ? nodeReadableToWeb(proc.stdout) : null,
    stderr: proc.stderr ? nodeReadableToWeb(proc.stderr) : null,
    exited: new Promise(resolve => {
      proc.on("close", code => resolve(code))
      proc.on("error", () => resolve(null))
    }),
    kill: () => proc.kill(),
  }
}

/** Minimal Bun surface for `M-x eval` in Electron (full Bun when running under Bun). */
export function runtimeBun(): typeof Bun {
  if (typeof Bun !== "undefined") return Bun
  return {
    file: (path: string) => ({
      exists: () => fileExists(path),
      text: () => readFileText(path),
    }),
    write: writeFileText,
    which: whichExecutable,
    spawn: (opts: SpawnOptions & { cmd?: string[] }) =>
      spawnProcess({ ...opts, cmd: opts.cmd ?? (opts as { command?: string[] }).command ?? [] }),
    argv: process.argv,
  } as unknown as typeof Bun
}
