import { dlopen, ptr } from "bun:ffi"
import { read, write, close } from "node:fs"

const openptySig = { openpty: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" } } as const
const ioctlSig = { ioctl: { args: ["i32", "u64", "ptr"], returns: "i32" } } as const
type OpenPtyLib = { symbols: { openpty: (...args: unknown[]) => number } }
type IoctlLib = { symbols: { ioctl: (...args: unknown[]) => number } }

/** Linux-only names in the original pty.ts; macOS/BSD need libutil.dylib + libSystem. */
function ptyLibs(): { util: OpenPtyLib; libc: IoctlLib; winsz: bigint } {
  switch (process.platform) {
    case "darwin":
      return {
        util: dlopen("/usr/lib/libutil.dylib", openptySig) as unknown as OpenPtyLib,
        libc: dlopen("/usr/lib/libSystem.B.dylib", ioctlSig) as unknown as IoctlLib,
        winsz: 0x80087467n,
      }
    case "linux":
      return {
        util: dlopen("libutil.so.1", openptySig) as unknown as OpenPtyLib,
        libc: dlopen("libc.so.6", ioctlSig) as unknown as IoctlLib,
        winsz: 0x5414n,
      }
    default:
      throw new Error(`term mode PTY is not supported on ${process.platform}`)
  }
}

const { util, libc, winsz: TIOCSWINSZ } = ptyLibs()

export type Pty = {
  pid: number
  write(data: string): void
  resize(rows: number, cols: number): void
  onData(fn: (chunk: string) => void): void
  onExit(fn: (code: number | null) => void): void
  kill(): void
}

export function spawnPty(argv: string[], opts?: { cwd?: string; rows?: number; cols?: number; env?: Record<string, string> }): Pty {
  const m = new Int32Array(1), s = new Int32Array(1)
  if (util.symbols.openpty(ptr(m), ptr(s), null, null, null) !== 0) {
    throw new Error("openpty failed")
  }
  const master = m[0]!, slave = s[0]!
  setWinsize(master, opts?.rows ?? 24, opts?.cols ?? 80)

  const proc = Bun.spawn(argv, {
    cwd: opts?.cwd,
    env: { ...process.env, TERM: "xterm-256color", ...opts?.env },
    stdin: slave, stdout: slave, stderr: slave,
  })
  // Parent doesn't need the slave once the child has it.
  close(slave, () => {})

  let dataHandlers: Array<(s: string) => void> = []
  let exitHandlers: Array<(c: number | null) => void> = []
  let alive = true
  const dec = new TextDecoder()

  function pump(): void {
    if (!alive) return
    const buf = new Uint8Array(4096)
    read(master, buf, 0, buf.length, null, (err, n) => {
      if (err || n <= 0) {
        if (alive) { alive = false; close(master, () => {}); for (const h of exitHandlers) h(proc.exitCode) }
        return
      }
      const chunk = dec.decode(buf.subarray(0, n), { stream: true })
      for (const h of dataHandlers) h(chunk)
      pump()
    })
  }
  pump()
  void proc.exited.then(code => { if (alive) { alive = false; close(master, () => {}); for (const h of exitHandlers) h(code) } })

  return {
    pid: proc.pid!,
    write(data) { write(master, new TextEncoder().encode(data), () => {}) },
    resize(rows, cols) {
      setWinsize(master, rows, cols)
      // Bun.spawn doesn't setsid()+TIOCSCTTY, so the slave isn't the child's
      // controlling tty and the kernel won't deliver SIGWINCH on TIOCSWINSZ.
      if (alive) try { process.kill(proc.pid!, "SIGWINCH") } catch {}
    },
    onData(fn) { dataHandlers.push(fn) },
    onExit(fn) { exitHandlers.push(fn) },
    kill() { proc.kill() },
  }
}

function setWinsize(fd: number, rows: number, cols: number): void {
  const ws = new Uint16Array([rows, cols, 0, 0])
  libc.symbols.ioctl(fd, TIOCSWINSZ, ptr(ws))
}
