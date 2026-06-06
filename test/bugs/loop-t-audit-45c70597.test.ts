import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, normalize, relative, sep } from "node:path"

// t-audit-45c70597 — layering: kernel/ is the "C core" (DESIGN.md) and must not
// take value-level imports upward from modes|display|themes|lsp|lisp|plugins.
// Type-only imports are allowed (erased at compile time, so @jemacs/core can
// ship without those packages).
test("kernel/ has no value-level imports from modes|display|themes|lsp|lisp|plugins", () => {
  const repo = join(import.meta.dir, "../..")
  const kernelDir = join(repo, "src/kernel")
  const forbidden = ["src/modes", "src/display", "src/themes", "src/lsp", "lisp", "plugins"]
  const importRe = /(?:^|\n)\s*(import|export)(\s+type)?\b[^;'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g

  const violations: string[] = []
  for (const f of readdirSync(kernelDir).filter(f => f.endsWith(".ts"))) {
    const src = readFileSync(join(kernelDir, f), "utf8")
    for (const m of src.matchAll(importRe)) {
      if (m[2]) continue // `import type` / `export type` — erased, no runtime dep
      const spec = m[3] ?? m[4]
      if (!spec || !spec.startsWith(".")) continue
      const target = relative(repo, normalize(join(kernelDir, spec)))
      const hit = forbidden.find(p => target === p || target.startsWith(p + sep))
      if (hit) violations.push(`src/kernel/${f} -> ${spec} (${hit})`)
    }
  }
  expect(violations).toEqual([])
})
