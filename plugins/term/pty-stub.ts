/** Electron / Node build stub — real PTY lives in pty.ts (Bun + bun:ffi). */
export type Pty = {
  pid: number
  write(data: string): void
  resize(rows: number, cols: number): void
  onData(fn: (chunk: string) => void): void
  onExit(fn: (code: number | null) => void): void
  kill(): void
}

export function spawnPty(
  _argv: string[],
  _opts?: { cwd?: string; rows?: number; cols?: number; env?: Record<string, string> },
): Pty {
  throw new Error("term mode requires the TUI (jemacs without --gui)")
}
