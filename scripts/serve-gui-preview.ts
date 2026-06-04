import { readFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const dir = join(root, "dist/electron")
const port = Number(process.env.PORT ?? 5173)

const preview = await Bun.build({
  entrypoints: [join(root, "src/electron/browser-preview.ts")],
  outdir: dir,
  target: "browser",
  format: "esm",
})
if (!preview.success) throw new Error(preview.logs.join("\n"))

const { cp, mkdir } = await import("node:fs/promises")
await mkdir(dir, { recursive: true })
await cp(join(root, "src/electron/gui-preview.html"), join(dir, "gui-preview.html"))
await cp(join(root, "src/electron/renderer.css"), join(dir, "renderer.css"))
await cp(join(root, "src/electron/fixtures"), join(dir, "fixtures"), { recursive: true })

const mime: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    let pathname = url.pathname
    if (pathname === "/") pathname = "/gui-preview.html"
    const filePath = join(dir, pathname)
    if (!filePath.startsWith(dir)) return new Response("Forbidden", { status: 403 })
    try {
      const body = await readFile(filePath)
      const ext = pathname.slice(pathname.lastIndexOf("."))
      return new Response(body, { headers: { "Content-Type": mime[ext] ?? "application/octet-stream" } })
    } catch {
      return new Response("Not found", { status: 404 })
    }
  },
})

console.log(`Jemacs GUI browser preview: http://localhost:${port}/gui-preview.html`)
