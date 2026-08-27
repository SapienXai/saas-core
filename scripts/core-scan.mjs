import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const forbidden = ["reserve" + "via", "fel" + "ix", "rest" + "aurant", "reserv" + "ation", "book" + "ing", "seat" + "ing", "data" + "engine"]
const ignoredDirectories = new Set([".git", ".reference", "node_modules", ".next", ".next-e2e", "output", ".pnpm-store"])
const textExtensions = new Set([".css", ".js", ".mjs", ".json", ".md", ".sql", ".ts", ".tsx", ".toml", ".yaml", ".yml", ".html", ".svg"])
const findings = []

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    const relative = path.relative(root, absolute)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await visit(absolute)
      continue
    }
    if (!textExtensions.has(path.extname(entry.name)) || relative === "README.md" || relative.startsWith(`docs${path.sep}`) || relative === "scripts/core-scan.mjs") continue
    const content = await readFile(absolute, "utf8")
    const lower = content.toLowerCase()
    const matches = forbidden.filter((term) => lower.includes(term))
    if (matches.length) findings.push(`${relative}: ${matches.join(", ")}`)
  }
}

await visit(root)
if (findings.length) {
  console.error("Forbidden product vocabulary found in Core runtime or configuration:")
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}
console.log("Core product-domain scan passed: no forbidden product coupling outside the extraction record.")
