import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const CORE_AREAS = new Set(["kernel", "modes", "runtime", "platform", "display", "lsp"])

function extensionCandidates(base) {
  if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(base)) return [base]
  return [
    base,
    ...[".ts", ".tsx", ".js", ".mjs"].map(ext => base + ext),
    ...["/index.ts", "/index.tsx", "/index.js", "/index.mjs"].map(ext => base + ext),
  ]
}

/** Map @jemacs/core imports to monorepo source files (Node exports cannot use ../ targets). */
function jemacsCoreCandidates(specifier) {
  const home = process.env.JEMACS_HOME
  if (!home) return []

  if (specifier === "@jemacs/core") {
    return extensionCandidates(join(home, "packages/jemacs-core/index.ts"))
  }

  const match = specifier.match(/^@jemacs\/core\/(.+)$/)
  if (!match) return []

  const rest = match[1]
  if (rest.startsWith("../")) {
    return extensionCandidates(join(home, "packages/jemacs-core", rest))
  }

  const slash = rest.indexOf("/")
  const area = slash === -1 ? rest : rest.slice(0, slash)
  if (!CORE_AREAS.has(area)) return []

  const rel = slash === -1 ? "" : rest.slice(slash + 1)
  return extensionCandidates(join(home, "src", area, rel))
}

async function resolveWithCandidates(candidates, context, nextResolve) {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      return await nextResolve(pathToFileURL(candidate).href, context)
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error
    }
  }
  return null
}

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

  const coreResolved = await resolveWithCandidates(jemacsCoreCandidates(specifier), context, nextResolve)
  if (coreResolved) return coreResolved

  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    for (const candidate of extensionCandidates(specifier)) {
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
