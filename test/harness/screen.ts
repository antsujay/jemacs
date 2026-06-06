/** Extract echo-area message from a tmux screen capture. */
export function extractEcho(screen: string): string {
  const lines = screen.split("\n").map(l => l.trimEnd())
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line) continue
    if (/line \d+, col \d+/.test(line)) continue
    if (/^-+UU-/.test(line) || /^\(Markdown|\(Fundamental/.test(line)) continue
    if (/^Jemacs OpenTUI/.test(line)) continue
    return line
  }
  return ""
}

export function extractModeline(screen: string): string {
  const lines = screen.split("\n").map(l => l.trimEnd()).filter(l => l.trim())
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (/line \d+, col \d+/.test(line) || /\(Markdown|\(Fundamental/.test(line)) return line.trim()
    if (/^-+UU-/.test(line)) return line.trim()
  }
  return lines.at(-1)?.trim() ?? ""
}
