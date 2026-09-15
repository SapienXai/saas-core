import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { DEFAULT_PRODUCT_OWNED_PATHS, isIgnoredPath, isProductOwnedPath } from "../packages/cli/bin/ownership.mjs"

const root = process.cwd()
const template = path.join(root, "packages/app/template")
const parityDirectories = ["app", "components", "context", "hooks", "i18n", "lib", "public", "src", "styles", "supabase"]
const parityFiles = [
  "eslint.config.mjs",
  "next.config.mjs",
  "postcss.config.mjs",
  "proxy.ts",
  "tailwind.config.ts",
  "tsconfig.json",
  "vitest.config.mjs",
  "test/server-only-shim.ts",
  "scripts/billing-sync-catalog.mjs",
  "scripts/generate-local-types.mjs",
]
const failures = []
const compared = new Set()

async function walk(directory, relative = "") {
  if (!existsSync(path.join(directory, relative))) return []
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = relative ? path.join(relative, entry.name) : entry.name
    if (entry.isDirectory()) files.push(...await walk(directory, child))
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"))
  }
  return files.sort()
}

function category(relative) {
  if (relative.startsWith("supabase/migrations/")) return "migrations"
  if (relative.startsWith("app/auth/") || relative.startsWith("components/auth/")) return "auth"
  if (relative.includes("authorization") || relative.includes("platform") || relative.includes("manage/")) return "authorization-management"
  if (relative.includes("billing") || relative.includes("entitlement") || relative.includes("plan")) return "billing-entitlements"
  if (relative.startsWith("app/") || relative.startsWith("components/")) return "application-surface"
  if (relative.startsWith("lib/") || relative.startsWith("supabase/")) return "runtime-schema"
  if (relative.startsWith("styles/") || relative.endsWith("config.mjs") || relative.endsWith("config.ts")) return "configuration-ui"
  return "tooling"
}

function sha256(value) { return createHash("sha256").update(value).digest("hex") }
function owned(relative) { return isIgnoredPath(relative) || isProductOwnedPath(relative, DEFAULT_PRODUCT_OWNED_PATHS) }

async function compare(relative) {
  if (owned(relative)) return
  const rootFile = path.join(root, relative)
  const templateFile = path.join(template, relative)
  if (!existsSync(rootFile)) {
    failures.push(`missing in root: ${relative}`)
    return
  }
  if (!existsSync(templateFile)) {
    failures.push(`missing in canonical template: ${relative}`)
    return
  }
  const [rootSource, templateSource] = await Promise.all([readFile(rootFile, "utf8"), readFile(templateFile, "utf8")])
  compared.add(relative)
  if (sha256(rootSource) !== sha256(templateSource)) failures.push(`content drift: ${relative}`)
}

const templateFiles = new Set([
  ...parityFiles,
  ...(await Promise.all(parityDirectories.map((directory) => walk(template, directory)))).flat(),
])
for (const relative of [...templateFiles].sort()) await compare(relative)

// The root application is the executable reference, but it must not contain a
// second Core-managed artifact that consumers would not receive.
for (const directory of parityDirectories) {
  for (const relative of await walk(root, directory)) {
    if (owned(relative) || templateFiles.has(relative)) continue
    failures.push(`extra Core candidate in root: ${relative}`)
  }
}

const rootMigrations = (await walk(root, "supabase/migrations"))
  .filter((relative) => relative.endsWith(".sql") && !relative.startsWith("supabase/migrations/product/"))
const templateMigrations = (await walk(template, "supabase/migrations"))
  .filter((relative) => relative.endsWith(".sql") && !relative.startsWith("supabase/migrations/product/"))
if (JSON.stringify(rootMigrations) !== JSON.stringify(templateMigrations)) {
  failures.push(`direct Core migration filename drift: root=${rootMigrations.join(", ")} template=${templateMigrations.join(", ")}`)
}
for (const relative of [...new Set([...rootMigrations, ...templateMigrations])].sort()) {
  const rootFile = path.join(root, relative)
  const templateFile = path.join(template, relative)
  if (!existsSync(rootFile) || !existsSync(templateFile)) continue
  const [rootSource, templateSource] = await Promise.all([readFile(rootFile, "utf8"), readFile(templateFile, "utf8")])
  compared.add(relative)
  if (sha256(rootSource) !== sha256(templateSource)) failures.push(`migration content drift: ${relative}`)
}

if (failures.length) {
  console.error("Root/template parity failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const comparedFiles = [...compared]
const counts = Object.fromEntries([...new Set(comparedFiles.map(category))].sort().map((name) => [name, comparedFiles.filter((relative) => category(relative) === name).length]))
console.log(JSON.stringify({ status: "PASS", comparedFiles: comparedFiles.length, categories: counts, directCoreMigrations: rootMigrations.length, ownershipSource: "packages/cli/bin/ownership.mjs" }, null, 2))
