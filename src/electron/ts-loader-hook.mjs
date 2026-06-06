import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ts = require("typescript")

/** Try `.ts` / `.tsx` suffixes for extensionless relative imports (Node ESM). */
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith("node:")
    || specifier.startsWith("bun:")
    || specifier.includes("://")
    || /\.(ts|tsx|js|mjs|cjs|json)$/.test(specifier)
  ) {
    return nextResolve(specifier, context)
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const candidates = [
      specifier,
      ...[".ts", ".tsx", ".js", ".mjs"].map(ext => specifier + ext),
      ...["/index.ts", "/index.tsx", "/index.js", "/index.mjs"].map(ext => specifier + ext),
    ]
    for (const candidate of candidates) {
      try {
        return await nextResolve(candidate, context)
      } catch (error) {
        if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error
      }
    }
  }
  return nextResolve(specifier, context)
}

/** Transpile `.ts` / `.tsx` for Electron main (Node has no native TypeScript). */
export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context)
  const path = fileURLToPath(url.split("?")[0])
  if (!path.endsWith(".ts") && !path.endsWith(".tsx")) return nextLoad(url, context)
  const source = readFileSync(path, "utf8")
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    fileName: path,
  })
  return { format: "module", source: outputText, shortCircuit: true }
}
