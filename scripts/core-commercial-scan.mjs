import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const roots = ["app", "components", "context", "hooks", "lib", "scripts", "supabase", "packages/core/src", "packages/config/src", "packages/ui/src"]
const forbidden = [
  /monthly_price_usd_cents/i,
  /activity_(?:count|limit)/i,
  /history_days/i,
  /\$19\b/,
  /\$49\b/,
  /\$99\b/,
  /\b(?:free|starter|pro|business)Plan\b(?=\s*[:=])/i,
  /\b(?:starter|pro|business)Positioning\b/i,
]
const findings = []
const extensions = new Set([".js", ".mjs", ".ts", ".tsx", ".sql", ".json"])

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!new Set(["node_modules", ".next", ".git", ".reference", "dist"]).has(entry.name)) await visit(absolute)
      continue
    }
    if (!extensions.has(path.extname(entry.name))) continue
    const relative = path.relative(root, absolute)
    if (relative === "scripts/core-commercial-scan.mjs") continue
    const content = await readFile(absolute, "utf8")
    const matches = forbidden.filter((pattern) => pattern.test(content)).map((pattern) => pattern.source)
    if (matches.length) findings.push({ file: relative, matches })
  }
}

for (const relative of roots) await visit(path.join(root, relative))
if (findings.length) {
  console.error("Commercial catalog assumptions found in Core runtime/contracts:")
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.matches.join(", ")}`)
  process.exit(1)
}
console.log("Core commercial assumption scan passed: plan names, prices, and usage metrics remain product-owned.")
