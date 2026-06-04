/** Subset of `lsp--client-capabilities` from lsp-mode.el. */

export function clientCapabilities(): Record<string, unknown> {
  return {
    workspace: {
      applyEdit: true,
      workspaceFolders: true,
      configuration: true,
      didChangeWatchedFiles: { dynamicRegistration: true },
    },
    textDocument: {
      synchronization: { willSave: true, didSave: true, willSaveWaitUntil: false },
      completion: {
        completionItem: {
          snippetSupport: false,
          documentationFormat: ["markdown", "plaintext"],
          deprecatedSupport: true,
        },
        contextSupport: true,
        dynamicRegistration: true,
      },
      hover: { contentFormat: ["markdown", "plaintext"], dynamicRegistration: true },
      definition: { dynamicRegistration: true, linkSupport: true },
      references: { dynamicRegistration: true },
      publishDiagnostics: { relatedInformation: true, versionSupport: true },
      formatting: { dynamicRegistration: true },
      rename: { dynamicRegistration: true, prepareSupport: true },
      codeAction: { dynamicRegistration: true },
    },
    window: { workDoneProgress: true },
  }
}
