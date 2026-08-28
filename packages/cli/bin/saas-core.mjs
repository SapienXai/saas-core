#!/usr/bin/env node

import { createHash } from "node:crypto"
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const VERSION = "2.0.0"
const SCHEMA_VERSION = "2.0"
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REPOSITORY_TEMPLATE = path.resolve(CLI_ROOT, "../app/template")
const PACKED_TEMPLATE = path.join(CLI_ROOT, "template")
const TEMPLATE_ROOT = process.env.SAAS_CORE_TEMPLATE ? path.resolve(process.env.SAAS_CORE_TEMPLATE) : existsSync(REPOSITORY_TEMPLATE) ? REPOSITORY_TEMPLATE : PACKED_TEMPLATE
const CORE_PACKAGES = ["@sapienx/saas-core", "@sapienx/saas-core-config", "@sapienx/saas-core-ui", "@sapienx/saas-core-app", "@sapienx/saas-core-cli"]
const IGNORED_FILES = new Set(["next-env.d.ts", ".gitignore", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"])
const PRODUCT_PREFIXES = ["src/product/", "app/(product)/", "app/product/", "components/product/", "supabase/migrations/product/"]
const PRODUCT_FILES = new Set(["lib/product-config.ts", "product.catalog.json", "styles/product.css", "app/page.tsx", "app/manage/page.tsx", "supabase/config.toml"])
const args = process.argv.slice(2)
const command = args[0] || "help"

function flags(values) {
  const result = { dryRun: false, json: false, to: null, positional: [] }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--dry-run") result.dryRun = true
    else if (value === "--json") result.json = true
    else if (value === "--to") result.to = values[++index] || null
    else if (value.startsWith("--to=")) result.to = value.slice(5)
    else if (!value.startsWith("--")) result.positional.push(value)
  }
  return result
}

function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "product"
}

function targetDirectory(value) { return path.resolve(process.cwd(), value || ".") }
function hash(value) { return createHash("sha256").update(value).digest("hex") }
function json(value) { return `${JSON.stringify(value, null, 2)}\n` }
function isProductOwned(relative) { return PRODUCT_FILES.has(relative) || PRODUCT_PREFIXES.some((prefix) => relative.startsWith(prefix)) || relative.startsWith("public/product-") }
function isIgnored(relative) { return IGNORED_FILES.has(relative) || relative === ".saas-core-manifest.json" || relative.startsWith(".next/") || relative.startsWith("node_modules/") || relative.startsWith("output/") || relative.startsWith("artifacts/") }
function managedHash(value) { return typeof value === "string" ? value : value?.hash || "" }

async function walk(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = relative ? path.join(relative, entry.name) : entry.name
    if (entry.isDirectory()) files.push(...await walk(root, child))
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"))
  }
  return files.sort()
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")) }
function readManifestSync(directory) {
  const file = path.join(directory, ".saas-core-manifest.json")
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, "utf8")) } catch { return null }
}

async function templateManagedFiles() {
  const result = new Map()
  for (const relative of await walk(TEMPLATE_ROOT)) {
    if (isIgnored(relative) || isProductOwned(relative)) continue
    result.set(relative, await readFile(path.join(TEMPLATE_ROOT, relative), "utf8"))
  }
  return result
}

async function managedFilesForConsumer(directory, sourceFiles) {
  const source = sourceFiles || await templateManagedFiles()
  const result = {}
  for (const relative of source.keys()) {
    const file = path.join(directory, relative)
    if (existsSync(file)) result[relative] = { hash: hash(await readFile(file, "utf8")), ownership: "managed" }
  }
  return result
}

function corePackageVersions() { return Object.fromEntries(CORE_PACKAGES.map((name) => [name, `^${VERSION}`])) }

async function appPackageManifest() {
  const candidates = [path.join(CLI_ROOT, "app-package.json"), path.resolve(CLI_ROOT, "../app/package.json")]
  for (const candidate of candidates) if (existsSync(candidate)) return readJson(candidate)
  return { dependencies: {}, devDependencies: {} }
}

async function copyTree(source, destination) {
  for (const relative of await walk(source)) {
    const target = path.join(destination, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await cp(path.join(source, relative), target, { force: true })
  }
}

async function writeProductConfig(directory, name, slug) {
  await writeFile(path.join(directory, "lib/product-config.ts"), `export type ProductConfig = {\n  name: string\n  slug: string\n  logoPath: string\n  iconPath: string\n  themeColor: string\n  description: string\n  capabilities: Readonly<Record<string, boolean>>\n  catalog: { plans: readonly unknown[]; usageMetrics: readonly unknown[] }\n}\n\nexport const PRODUCT_CONFIG: ProductConfig = {\n  name: ${JSON.stringify(name)},\n  slug: ${JSON.stringify(slug)},\n  logoPath: "/product-mark.svg",\n  iconPath: "/product-mark.svg",\n  themeColor: "#7c3aed",\n  description: ${JSON.stringify(`${name} workspace management.`)},\n  capabilities: { billing: true, domains: true, platformControl: true, pushNotifications: true, pwa: true },\n  catalog: { plans: [], usageMetrics: [] },\n}\n`, "utf8")
  await writeFile(path.join(directory, "product.catalog.json"), json({ defaultPlanKey: null, plans: [], usageMetrics: [] }), "utf8")
  await mkdir(path.join(directory, "src/product"), { recursive: true })
  await writeFile(path.join(directory, "src/product/domain.ts"), `export type ProductDomain = { workspaceId: string }\n\n// Product-owned domain starts at the Core Workspace boundary.\nexport const productDomain: ProductDomain = { workspaceId: "" }\n`, "utf8")
}

async function writeConsumerPackage(directory, slug) {
  const app = await appPackageManifest()
  const dependencies = { ...(app.dependencies || {}), ...corePackageVersions() }
  const devDependencies = { ...(app.devDependencies || {}) }
  delete devDependencies["@sapienx/saas-core-cli"]
  await writeFile(path.join(directory, "package.json"), json({
    name: slug,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { dev: "next dev", build: "next build --webpack", start: "next start", lint: "eslint .", typecheck: "tsc --noEmit", test: "vitest run", "saas-core": "saas-core" },
    dependencies,
    devDependencies,
  }), "utf8")
}

function manifestData(name, slug, managedFiles) {
  return { coreVersion: VERSION, schemaVersion: SCHEMA_VERSION, packageVersions: corePackageVersions(), managedFiles, productOwnedPaths: [...PRODUCT_PREFIXES, ...PRODUCT_FILES], templateVersion: VERSION, product: { name, slug }, generatedAt: new Date().toISOString() }
}

async function init(options) {
  const name = options.positional[0]
  if (!name) throw new Error("Usage: saas-core init <product-name> [directory]")
  const slug = slugify(name)
  const directory = targetDirectory(options.positional[1] || slug)
  await mkdir(directory, { recursive: true })
  await copyTree(TEMPLATE_ROOT, directory)
  await writeProductConfig(directory, name, slug)
  await writeConsumerPackage(directory, slug)
  await writeFile(path.join(directory, ".saas-core-manifest.json"), json(manifestData(name, slug, await managedFilesForConsumer(directory))), "utf8")
  await writeFile(path.join(directory, "README.md"), `# ${name}\n\nA product built on the SaaS Core workspace platform. Add product tables, routes, navigation and commercial configuration without changing Core tenancy or security infrastructure.\n`, "utf8")
  console.log(`Created portable SaaS Core product at ${path.relative(process.cwd(), directory) || "."}.`)
}

function packageDrift(packageJson, expected = corePackageVersions()) {
  const all = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) }
  return CORE_PACKAGES.filter((name) => all[name] !== expected[name]).map((name) => ({ name, expected: expected[name], actual: all[name] || null }))
}

function localPathValues(packageJson) {
  const all = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) }
  return Object.entries(all).filter(([, value]) => /^(file:|link:|\.|\/Users\/|\/private\/|[A-Za-z]:\\)/.test(value)).map(([name, value]) => ({ name, value }))
}

function productConfigValid(directory) {
  const file = path.join(directory, "product.catalog.json")
  if (!existsSync(file)) return { status: "WARNING", detail: "product.catalog.json is not present; product catalog bootstrap is optional." }
  try {
    const catalog = JSON.parse(readFileSync(file, "utf8"))
    if (!catalog || !Array.isArray(catalog.plans) || !Array.isArray(catalog.usageMetrics)) return { status: "ERROR", detail: "product.catalog.json must contain plans and usageMetrics arrays." }
    const keys = catalog.plans.map((plan) => plan?.key).filter(Boolean)
    if (new Set(keys).size !== keys.length || keys.some((key) => !/^[a-z][a-z0-9_-]{0,63}$/.test(key))) return { status: "ERROR", detail: "Product plan keys must be unique stable keys." }
    const metricKeys = catalog.usageMetrics.map((metric) => metric?.key).filter(Boolean)
    if (new Set(metricKeys).size !== metricKeys.length || metricKeys.some((key) => !/^[a-z][a-z0-9_-]{0,63}$/.test(key))) return { status: "ERROR", detail: "Product usage metric keys must be unique stable keys." }
    if (catalog.defaultPlanKey !== undefined && catalog.defaultPlanKey !== null && !keys.includes(catalog.defaultPlanKey)) return { status: "ERROR", detail: "defaultPlanKey must refer to a product plan." }
    if (catalog.plans.some((plan) => !plan?.name || (plan.features !== undefined && typeof plan.features !== "object") || (plan.limits !== undefined && typeof plan.limits !== "object"))) return { status: "ERROR", detail: "Each product plan needs a name and object-shaped features/limits." }
    return { status: "INFO", detail: `${keys.length} product plan(s), ${metricKeys.length} usage metric(s)` }
  } catch { return { status: "ERROR", detail: "product.catalog.json is not valid JSON." } }
}

async function healthChecks(directory, manifest) {
  const checks = []
  const add = (category, status, detail) => checks.push({ category, status, detail })
  if (!manifest) add("MANIFEST", "ERROR", "Missing or invalid .saas-core-manifest.json")
  else {
    add("CORE", "INFO", `Core ${manifest.coreVersion || "unknown"} / schema ${manifest.schemaVersion || "unknown"}`)
    if (manifest.coreVersion !== VERSION) add("VERSION", "ERROR", `Manifest targets Core ${manifest.coreVersion}; installed CLI is ${VERSION}.`)
    if (manifest.schemaVersion !== SCHEMA_VERSION) add("SCHEMA", "ERROR", `Manifest targets schema ${manifest.schemaVersion}; expected ${SCHEMA_VERSION}.`)
    if (!manifest.packageVersions || !manifest.managedFiles) add("MANIFEST", "ERROR", "Manifest is missing packageVersions or managedFiles.")
  }
  let packageJson = null
  try { packageJson = await readJson(path.join(directory, "package.json")); add("PACKAGE", "INFO", "package.json is readable.") } catch { add("PACKAGE", "ERROR", "package.json is missing or invalid JSON.") }
  const paths = localPathValues(packageJson)
  if (paths.length) add("PORTABILITY", "ERROR", `Local dependency paths: ${paths.map((item) => `${item.name}=${item.value}`).join(", ")}`)
  else add("PORTABILITY", "INFO", "No local or checkout dependency paths found.")
  const drift = packageDrift(packageJson, manifest?.packageVersions || corePackageVersions())
  if (drift.length) add("PACKAGE", "ERROR", `Core package drift: ${drift.map((item) => `${item.name}=${item.actual || "missing"}`).join(", ")}`)
  else add("PACKAGE", "INFO", "Core package versions are compatible and portable.")
  if (!existsSync(path.join(directory, "supabase/migrations"))) add("SCHEMA", "ERROR", "Supabase migration directory is missing.")
  else add("SCHEMA", "INFO", "Core migration directory is present.")
  const catalog = productConfigValid(directory)
  add("PRODUCT", catalog.status, catalog.detail)
  if (manifest?.managedFiles) {
    let changed = 0
    let missing = 0
    for (const [relative, record] of Object.entries(manifest.managedFiles)) {
      const file = path.join(directory, relative)
      if (!existsSync(file)) { missing += 1; continue }
      if (hash(await readFile(file, "utf8")) !== managedHash(record)) changed += 1
    }
    if (missing) add("MANAGED", "ERROR", `${missing} Core-managed file(s) are missing.`)
    if (changed) add("MANAGED", "ERROR", `${changed} Core-managed file(s) differ from the recorded baseline.`)
    if (!missing && !changed) add("MANAGED", "INFO", `${Object.keys(manifest.managedFiles).length} Core-managed files are healthy.`)
  }
  add("ENVIRONMENT", "WARNING", "Provider credentials are optional for Core health; configure them before enabling delivery or billing operations.")
  return checks
}

function printChecks(checks, asJson) {
  if (asJson) { console.log(JSON.stringify({ checks, errors: checks.filter((item) => item.status === "ERROR").length, warnings: checks.filter((item) => item.status === "WARNING").length }, null, 2)); return }
  for (const item of checks) console.log(`${item.status === "ERROR" ? "✗" : item.status === "WARNING" ? "!" : "✓"} [${item.category}] ${item.detail}`)
  console.log(`\n${checks.filter((item) => item.status !== "ERROR").length} healthy  ${checks.filter((item) => item.status === "WARNING").length} warnings  ${checks.filter((item) => item.status === "ERROR").length} errors`)
}

async function doctor(options) {
  const directory = targetDirectory(options.positional[0])
  const checks = await healthChecks(directory, readManifestSync(directory))
  printChecks(checks, options.json)
  if (checks.some((item) => item.status === "ERROR")) process.exitCode = 1
}

async function diff(options) {
  const directory = targetDirectory(options.positional[0])
  const manifest = readManifestSync(directory)
  if (!manifest) throw new Error("Missing or invalid .saas-core-manifest.json")
  const core = []
  const version = []
  const packages = packageDrift(await readJson(path.join(directory, "package.json")), manifest.packageVersions || corePackageVersions())
  if (manifest.coreVersion !== VERSION) version.push(`Core version ${manifest.coreVersion} → ${VERSION}`)
  if (manifest.schemaVersion !== SCHEMA_VERSION) version.push(`Schema version ${manifest.schemaVersion} → ${SCHEMA_VERSION}`)
  for (const [relative, record] of Object.entries(manifest.managedFiles || {})) {
    const file = path.join(directory, relative)
    if (!existsSync(file)) core.push(`D ${relative}`)
    else if (hash(await readFile(file, "utf8")) !== managedHash(record)) core.push(`M ${relative}`)
  }
  for (const relative of (await templateManagedFiles()).keys()) if (!manifest.managedFiles?.[relative]) core.push(`A ${relative}`)
  const productChanges = (await walk(directory)).filter((relative) => isProductOwned(relative) && !isIgnored(relative) && !manifest.managedFiles?.[relative])
  const report = { coreDrift: core, versionDrift: version, packageDrift: packages, schemaDrift: manifest.schemaVersion === SCHEMA_VERSION ? [] : ["Core schema version differs"], productChangesIgnored: productChanges }
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log("Core drift:"); console.log(core.length ? core.map((item) => `  ${item}`).join("\n") : "  none")
    console.log("Version drift:"); console.log(version.length ? version.map((item) => `  ${item}`).join("\n") : "  none")
    console.log("Package drift:"); console.log(packages.length ? packages.map((item) => `  ${item.name}: ${item.actual || "missing"} (expected ${item.expected})`).join("\n") : "  none")
    console.log(`Product changes: ignored (${productChanges.length})`)
  }
  if (core.length || version.length || packages.length) process.exitCode = 2
}

function mergeCoreDependencies(current, expected) {
  const next = { ...current }
  const dependencies = { ...(next.dependencies || {}) }
  const devDependencies = { ...(next.devDependencies || {}) }
  for (const name of CORE_PACKAGES) {
    dependencies[name] = expected[name]
    delete devDependencies[name]
  }
  next.dependencies = dependencies
  if (Object.keys(devDependencies).length) next.devDependencies = devDependencies
  else delete next.devDependencies
  return next
}

async function update(options) {
  let directoryValue = options.positional[0]
  let targetVersion = options.to || VERSION
  if (directoryValue && /^\d+\.\d+\.\d+$/.test(directoryValue)) { targetVersion = directoryValue; directoryValue = "." }
  const directory = targetDirectory(directoryValue)
  if (targetVersion !== VERSION) throw new Error(`Core ${targetVersion} is not available in this distribution.`)
  const manifest = readManifestSync(directory)
  if (!manifest) throw new Error("Missing or invalid .saas-core-manifest.json")
  const source = await templateManagedFiles()
  const previous = manifest.managedFiles || {}
  const additions = []
  const replacements = []
  const removals = []
  const conflicts = []
  const backupName = new Date().toISOString().replace(/[:.]/g, "-")
  const backup = path.join(directory, ".saas-core-backups", backupName)
  const saveBackup = async (relative) => {
    const current = path.join(directory, relative)
    if (!existsSync(current) || options.dryRun) return
    const destination = path.join(backup, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(current, destination)
  }
  for (const [relative, content] of source) {
    const current = path.join(directory, relative)
    const record = previous[relative]
    if (!existsSync(current)) { additions.push(relative); continue }
    const currentHash = hash(await readFile(current, "utf8"))
    if (currentHash === hash(content)) continue
    if (!record || currentHash !== managedHash(record)) { conflicts.push(relative); continue }
    replacements.push(relative)
  }
  for (const relative of Object.keys(previous)) {
    if (source.has(relative) || isProductOwned(relative)) continue
    const current = path.join(directory, relative)
    if (!existsSync(current)) continue
    if (hash(await readFile(current, "utf8")) !== managedHash(previous[relative])) { conflicts.push(relative); continue }
    removals.push(relative)
  }
  const packageFile = path.join(directory, "package.json")
  let packageChanged = false
  if (existsSync(packageFile)) {
    const currentPackage = await readJson(packageFile)
    const nextPackage = mergeCoreDependencies(currentPackage, corePackageVersions())
    packageChanged = JSON.stringify(currentPackage) !== JSON.stringify(nextPackage)
  }
  const changed = additions.length + replacements.length + removals.length + (packageChanged ? 1 : 0)
  if (!options.dryRun && !conflicts.length) {
    for (const relative of additions) {
      const current = path.join(directory, relative)
      await mkdir(path.dirname(current), { recursive: true })
      await writeFile(current, source.get(relative), "utf8")
    }
    for (const relative of replacements) {
      const current = path.join(directory, relative)
      await saveBackup(relative)
      await writeFile(current, source.get(relative), "utf8")
    }
    for (const relative of removals) {
      await saveBackup(relative)
      await rm(path.join(directory, relative))
    }
    if (packageChanged) {
      const currentPackage = await readJson(packageFile)
      await saveBackup("package.json")
      await writeFile(packageFile, json(mergeCoreDependencies(currentPackage, corePackageVersions())), "utf8")
    }
    const managedFiles = await managedFilesForConsumer(directory, source)
    await writeFile(path.join(directory, ".saas-core-manifest.json"), json({ ...manifest, coreVersion: VERSION, schemaVersion: SCHEMA_VERSION, packageVersions: corePackageVersions(), templateVersion: VERSION, managedFiles, generatedAt: new Date().toISOString() }), "utf8")
  }
  const report = { dryRun: options.dryRun, targetVersion, updated: [...replacements, ...(packageChanged ? ["package.json"] : [])], added: additions, removed: removals, preserved: conflicts, conflicts, backup: options.dryRun || changed === 0 || conflicts.length ? null : backup }
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(options.dryRun ? "Dry-run update" : conflicts.length ? "Core update completed with conflicts preserved" : "Core update completed")
    console.log(`Updated: ${report.updated.length}`); console.log(`Added: ${report.added.length}`); console.log(`Removed: ${report.removed.length}`); console.log(`Preserved: ${report.preserved.length}`)
    if (report.backup) console.log(`Backup: ${report.backup}`)
    for (const item of conflicts) console.log(`Conflict: ${item}`)
    if (options.dryRun) for (const item of [...replacements, ...additions, ...removals]) console.log(`  ${item}`)
  }
  if (conflicts.length) process.exitCode = 2
}

function help() { console.log("Usage: saas-core <init|doctor|diff|update> [directory] [--dry-run] [--json] [--to <version>]") }

try {
  const options = flags(args.slice(1))
  if (command === "init") await init(options)
  else if (command === "doctor") await doctor(options)
  else if (command === "diff") await diff(options)
  else if (command === "update") await update(options)
  else help()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
