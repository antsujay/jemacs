import { register } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
register(pathToFileURL(join(here, "ts-loader-hook.mjs")).href, import.meta.url)

const home = process.env.JEMACS_HOME
if (!home) throw new Error("JEMACS_HOME is not set (jemacs wrapper should export it)")
await import(pathToFileURL(join(home, "src/main-electron.ts")).href)
