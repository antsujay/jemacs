import { registerClient, activateOn } from "../client"
import { serverBinaryAvailable } from "../server-path"
import { stdioConnection } from "../stdio"

/** Port of `lsp-pylsp.el` client registration (simplified initialization). */
export function registerPylspClient(): void {
  registerClient({
    serverId: "pylsp",
    majorModes: ["python"],
    priority: -1,
    activationFn: activateOn("python"),
    languageId: () => "python",
    newConnection: stdioConnection(["pylsp"], () => serverBinaryAvailable("pylsp")),
    initializationOptions: {
      pylsp: {
        plugins: {
          jedi_completion: { enabled: true },
          jedi_definition: { enabled: true },
          jedi_hover: { enabled: true },
          rope_completion: { enabled: false },
        },
      },
    },
  })
}
