import { registerClient } from "../client"
import { findServerBinary, serverBinaryAvailable } from "../server-path"
import { stdioConnection } from "../stdio"

const SERVER = "typescript-language-server"

/** typescript-language-server for js-ts-mode / typescript-ts-mode hooks in ~/.emacs.d/stephen.el. */
export function registerTypescriptLanguageServerClient(): void {
  registerClient({
    serverId: SERVER,
    majorModes: ["javascript", "typescript"],
    priority: 10,
    languageId: buffer => (buffer.mode === "typescript" ? "typescript" : "javascript"),
    newConnection: stdioConnection(
      cwd => {
        const bin = findServerBinary(SERVER, cwd)
        if (!bin) throw new Error(`${SERVER} not found (npm i -D typescript-language-server)`)
        return [bin, "--stdio"]
      },
      buffer => serverBinaryAvailable(SERVER, buffer),
    ),
  })
}
