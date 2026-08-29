#!/usr/bin/env node

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const VERSION = "2.0.0"
const SCHEMA_VERSION = "2.0"
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REPOSITORY_TEMPLATE = path.resolve(CLI_ROOT, "../app/template")
const PACKED_TEMPLATE = path.join(CLI_ROOT, "template")
const DEFAULT_TEMPLATE_ROOT = process.env.SAAS_CORE_TEMPLATE ? path.resolve(process.env.SAAS_CORE_TEMPLATE) : existsSync(REPOSITORY_TEMPLATE) ? REPOSITORY_TEMPLATE : PACKED_TEMPLATE
const RUNTIME_CORE_PACKAGES = ["@sapienx/saas-core", "@sapienx/saas-core-config", "@sapienx/saas-core-ui"]
const TOOLING_CORE_PACKAGES = ["@sapienx/saas-core-cli"]
const CORE_PACKAGES = [...RUNTIME_CORE_PACKAGES, ...TOOLING_CORE_PACKAGES]
const IGNORED_FILES = new Set(["next-env.d.ts", ".gitignore", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"])
const PRODUCT_PREFIXES = ["src/product/", "app/(product)/", "app/product/", "components/product/", "supabase/migrations/product/"]
const PRODUCT_FILES = new Set(["lib/product-config.ts", "product.catalog.json", "styles/product-theme.css", "styles/product.css", "app/page.tsx", "app/manage/page.tsx", "supabase/config.toml", "supabase/seed.sql"])
const DEFAULT_PRODUCT_OWNED_PATHS = [...PRODUCT_PREFIXES, ...PRODUCT_FILES]
const args = process.argv.slice(2)
const command = args[0] || "help"

function flags(values) {
  const result = { dryRun: false, json: false, source: null, to: null, positional: [] }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--dry-run") result.dryRun = true
    else if (value === "--json") result.json = true
    else if (value === "--source") {
      const source = values[++index]
      if (!source || source.startsWith("--")) throw new Error("--source requires a Core repository or template path.")
      result.source = source
    }
    else if (value.startsWith("--source=")) result.source = value.slice(9)
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
function sourceGitCommit(sourceRoot) {
  try {
    const commit = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    return /^[0-9a-f]{40}$/.test(commit) ? commit : null
  } catch { return null }
}
function isProductOwned(relative, productOwnedPaths = DEFAULT_PRODUCT_OWNED_PATHS) {
  return relative.startsWith("public/product-") || productOwnedPaths.some((ownedPath) => ownedPath.endsWith("/") ? relative.startsWith(ownedPath) : relative === ownedPath)
}
function isIgnored(relative) { return IGNORED_FILES.has(relative) || relative === ".saas-core-manifest.json" || relative === "supabase/.gitignore" || relative.startsWith(".next/") || relative.startsWith("node_modules/") || relative.startsWith("output/") || relative.startsWith("artifacts/") || relative.startsWith("supabase/.branches/") || relative.startsWith("supabase/.temp/") }
function managedHash(value) { return typeof value === "string" ? value : value?.hash || "" }

function manifestProductOwnedPaths(manifest) {
  const configured = Array.isArray(manifest?.productOwnedPaths)
    ? manifest.productOwnedPaths.filter((value) => typeof value === "string" && value.length > 0)
    : []
  return [...new Set([...DEFAULT_PRODUCT_OWNED_PATHS, ...configured])]
}

function resolveTemplateRoot(source) {
  if (!source) return DEFAULT_TEMPLATE_ROOT
  const requested = path.resolve(process.cwd(), source)
  const candidates = [
    path.join(requested, "packages/app/template"),
    path.join(requested, "app/template"),
    requested,
  ]
  const resolved = candidates.find((candidate) => existsSync(path.join(candidate, "app/layout.tsx")))
  if (!resolved) throw new Error(`Invalid Core source ${source}; expected a Core repository or app template containing app/layout.tsx.`)
  return resolved
}

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

async function templateManagedFiles(sourceRoot = DEFAULT_TEMPLATE_ROOT, productOwnedPaths = DEFAULT_PRODUCT_OWNED_PATHS) {
  const result = new Map()
  for (const relative of await walk(sourceRoot)) {
    if (isIgnored(relative) || isProductOwned(relative, productOwnedPaths)) continue
    result.set(relative, await readFile(path.join(sourceRoot, relative), "utf8"))
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

async function appPackageManifest(sourceRoot = DEFAULT_TEMPLATE_ROOT) {
  const candidates = [path.join(CLI_ROOT, "app-package.json"), path.resolve(sourceRoot, "../package.json"), path.resolve(CLI_ROOT, "../app/package.json")]
  for (const candidate of candidates) if (existsSync(candidate)) return readJson(candidate)
  return { dependencies: {}, devDependencies: {} }
}

async function copyTree(source, destination) {
  for (const relative of await walk(source)) {
    if (isIgnored(relative)) continue
    const target = path.join(destination, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await cp(path.join(source, relative), target, { force: true })
  }
}

async function writeProductConfig(directory, name, slug) {
  await writeFile(path.join(directory, "lib/product-config.ts"), `import productCatalog from "@/product.catalog.json"

export type ProductConfig = {
  name: string
  slug: string
  logoPath: string
  iconPath: string
  themeColor: string
  description: string
  capabilities: Readonly<Record<string, boolean>>
  onboarding?: { productSetupPath?: string | null; workspaceProvisioning?: "manual" | "deferred" }
  auth?: ProductAuthConfig
  shell?: ProductShellConfig
  catalog: ProductCatalog
}

export type ProductAuthConfig = {
  /** Optional HTTPS media surface rendered behind Core auth forms. */
  backgroundUrl?: string | null
}

export type ProductShellNavigationItem = {
  key: string
  label: string
  href: string
  icon?: string
  match?: "exact" | "prefix"
  workspaceRoles?: readonly ("owner" | "admin" | "manager" | "staff" | "readonly")[]
  requiredFeature?: string
}

export type ProductShellConfig = {
  homePath?: string | null
  homeLabel?: string | null
  navigation?: readonly ProductShellNavigationItem[]
}

export type ProductPlanDefinition = {
  key: string
  name: string
  description?: string
  active?: boolean
  prices?: Readonly<Record<string, { amount: number | null; currency: string; providerPriceId?: string }>>
  features?: Readonly<Record<string, boolean>>
  limits?: Readonly<Record<string, number | null>>
  metadata?: Readonly<Record<string, unknown>>
}

export type ProductUsageMetricDefinition = { key: string; name: string; unit?: string }
export type ProductCatalog = { defaultPlanKey: string; plans: readonly ProductPlanDefinition[]; usageMetrics?: readonly ProductUsageMetricDefinition[] }

export const PRODUCT_CONFIG: ProductConfig = {
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  logoPath: "/product-mark.svg",
  iconPath: "/product-mark.svg",
  themeColor: "#7c3aed",
  description: ${JSON.stringify(`${name} workspace management.`)},
  capabilities: { billing: true, domains: true, platformControl: true, pushNotifications: true, pwa: true },
  onboarding: { productSetupPath: "/app" },
  catalog: productCatalog,
}

export function getProductOnboardingPath() {
  const configured = PRODUCT_CONFIG.onboarding?.productSetupPath?.trim()
  if (!configured || !configured.startsWith("/") || configured.startsWith("//")) return "/app"
  return configured
}

export function getWorkspaceProvisioningMode() {
  return PRODUCT_CONFIG.onboarding?.workspaceProvisioning === "deferred" ? "deferred" as const : "manual" as const
}

export function isDeferredWorkspaceProvisioning() {
  return getWorkspaceProvisioningMode() === "deferred"
}
`, "utf8")
  await writeFile(path.join(directory, "product.catalog.json"), json({
    defaultPlanKey: "default",
    plans: [{ key: "default", name: "Default", features: {}, limits: { "core.workspaces": 1, "core.members": null }, metadata: { development: true } }],
    usageMetrics: [],
  }), "utf8")
  await mkdir(path.join(directory, "src/product"), { recursive: true })
  await writeFile(path.join(directory, "src/product/domain.ts"), `export type ProductDomain = { workspaceId: string }\n\n// Product-owned domain starts at the Core Workspace boundary.\nexport const productDomain: ProductDomain = { workspaceId: "" }\n`, "utf8")
}

async function writeConsumerPackage(directory, slug, sourceRoot) {
  const app = await appPackageManifest(sourceRoot)
  const dependencies = { ...(app.templateDependencies || app.dependencies || {}), ...Object.fromEntries(RUNTIME_CORE_PACKAGES.map((name) => [name, `^${VERSION}`])) }
  const devDependencies = { ...(app.devDependencies || {}) }
  devDependencies["@sapienx/saas-core-cli"] = `^${VERSION}`
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

function manifestData(name, slug, managedFiles, coreSourceCommit = null) {
  const manifest = { coreVersion: VERSION, schemaVersion: SCHEMA_VERSION, packageVersions: corePackageVersions(), managedFiles, productOwnedPaths: [...PRODUCT_PREFIXES, ...PRODUCT_FILES], templateVersion: VERSION, product: { name, slug }, generatedAt: new Date().toISOString() }
  if (coreSourceCommit) manifest.coreSourceCommit = coreSourceCommit
  return manifest
}

async function init(options) {
  const name = options.positional[0]
  if (!name) throw new Error("Usage: saas-core init <product-name> [directory]")
  const slug = slugify(name)
  const directory = targetDirectory(options.positional[1] || slug)
  const sourceRoot = resolveTemplateRoot(options.source)
  const sourceFiles = await templateManagedFiles(sourceRoot)
  await mkdir(directory, { recursive: true })
  await copyTree(sourceRoot, directory)
  await writeProductConfig(directory, name, slug)
  await writeConsumerPackage(directory, slug, sourceRoot)
  await writeFile(path.join(directory, ".saas-core-manifest.json"), json(manifestData(name, slug, await managedFilesForConsumer(directory, sourceFiles), options.source ? sourceGitCommit(sourceRoot) : null)), "utf8")
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
  if (!existsSync(file)) return { status: "ERROR", detail: "product.catalog.json is missing; workspace creation cannot resolve a default plan." }
  try {
    const catalog = JSON.parse(readFileSync(file, "utf8"))
    if (!catalog || !Array.isArray(catalog.plans) || !Array.isArray(catalog.usageMetrics)) return { status: "ERROR", detail: "product.catalog.json must contain plans and usageMetrics arrays." }
    if (!catalog.plans.length) return { status: "ERROR", detail: "Product catalog has no plans; workspace creation will fail until a catalog is synchronized." }
    const keys = catalog.plans.map((plan) => plan?.key).filter(Boolean)
    if (new Set(keys).size !== keys.length || keys.some((key) => !/^[a-z][a-z0-9_-]{0,63}$/.test(key))) return { status: "ERROR", detail: "Product plan keys must be unique stable keys." }
    const metricKeys = catalog.usageMetrics.map((metric) => metric?.key).filter(Boolean)
    if (new Set(metricKeys).size !== metricKeys.length || metricKeys.some((key) => !/^[a-z][a-z0-9_-]{0,63}$/.test(key))) return { status: "ERROR", detail: "Product usage metric keys must be unique stable keys." }
    if (catalog.plans.some((plan) => !plan?.name || (plan.features !== undefined && typeof plan.features !== "object") || (plan.limits !== undefined && typeof plan.limits !== "object"))) return { status: "ERROR", detail: "Each product plan needs a name and object-shaped features/limits." }
    if (typeof catalog.defaultPlanKey !== "string" || !keys.includes(catalog.defaultPlanKey)) return { status: "ERROR", detail: "defaultPlanKey must refer to an existing product plan." }
    const defaultPlan = catalog.plans.find((plan) => plan.key === catalog.defaultPlanKey)
    if (defaultPlan?.active === false) return { status: "ERROR", detail: `defaultPlanKey ${catalog.defaultPlanKey} is inactive; workspace creation will fail.` }
    if (!defaultPlan || !defaultPlan.limits || !Object.prototype.hasOwnProperty.call(defaultPlan.limits, "core.workspaces")) return { status: "ERROR", detail: "The default plan must explicitly define limits.core.workspaces; use null only for intentional unlimited workspaces." }
    return { status: "INFO", detail: `${keys.length} product plan(s), ${metricKeys.length} usage metric(s), default ${catalog.defaultPlanKey}` }
  } catch { return { status: "ERROR", detail: "product.catalog.json is not valid JSON." } }
}

async function databaseSchemaCheck() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || /publishable|anon/i.test(serviceKey)) return { status: "WARNING", detail: "Database schema could not be verified because server credentials are not configured." }
  try {
    const endpoint = new URL("/rest/v1/rpc/get_core_schema_metadata", url)
    const response = await fetch(endpoint, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } })
    const body = await response.text()
    if (!response.ok) return { status: "ERROR", detail: `Database schema metadata could not be read: ${body || response.statusText}` }
    const value = JSON.parse(body)
    const metadata = Array.isArray(value) ? value[0] : value
    if (!metadata || metadata.schema_version !== SCHEMA_VERSION || metadata.runtime_major !== 2) return { status: "ERROR", detail: `Database schema ${metadata?.schema_version || "unknown"} is incompatible with expected Core schema ${SCHEMA_VERSION}.` }
    return { status: "INFO", detail: `Core schema ${SCHEMA_VERSION} verified.` }
  } catch (error) {
    return { status: "ERROR", detail: `Database schema verification failed: ${error instanceof Error ? error.message : String(error)}` }
  }
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
  const database = await databaseSchemaCheck()
  add("DATABASE", database.status, database.detail)
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
  const sourceRoot = resolveTemplateRoot(options.source)
  const productOwnedPaths = manifestProductOwnedPaths(manifest)
  const source = await templateManagedFiles(sourceRoot, productOwnedPaths)
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
  for (const relative of source.keys()) if (!manifest.managedFiles?.[relative]) core.push(`A ${relative}`)
  const productChanges = (await walk(directory)).filter((relative) => isProductOwned(relative, productOwnedPaths) && !isIgnored(relative) && !manifest.managedFiles?.[relative])
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
    delete dependencies[name]
    delete devDependencies[name]
  }
  for (const name of RUNTIME_CORE_PACKAGES) dependencies[name] = expected[name]
  for (const name of TOOLING_CORE_PACKAGES) devDependencies[name] = expected[name]
  next.dependencies = dependencies
  if (Object.keys(devDependencies).length) next.devDependencies = devDependencies
  else delete next.devDependencies
  return next
}

async function nearestWritableDirectory(target) {
  let candidate = target
  while (!existsSync(candidate)) {
    const parent = path.dirname(candidate)
    if (parent === candidate) throw new Error(`Could not resolve a writable parent for ${target}.`)
    candidate = parent
  }
  const details = await stat(candidate)
  if (!details.isDirectory()) throw new Error(`Expected a directory while checking ${target}.`)
  await access(candidate, 2)
}

async function verifyUpdatePaths(directory, relatives) {
  for (const relative of new Set(relatives)) {
    const target = path.join(directory, relative)
    if (existsSync(target)) {
      const details = await stat(target)
      if (details.isDirectory()) throw new Error(`Cannot update ${relative}: destination is a directory.`)
      await access(target, 2)
    } else {
      await nearestWritableDirectory(path.dirname(target))
    }
  }
}

async function createUpdateBackup(directory, backup, relatives) {
  await mkdir(path.dirname(backup), { recursive: true })
  await mkdir(backup)
  const entries = {}
  for (const relative of new Set(relatives)) {
    const current = path.join(directory, relative)
    if (!existsSync(current)) {
      entries[relative] = { exists: false }
      continue
    }
    const details = await stat(current)
    if (!details.isFile()) throw new Error(`Cannot back up ${relative}: it is not a regular file.`)
    const destination = path.join(backup, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(current, destination)
    entries[relative] = { exists: true }
  }
  await writeFile(path.join(backup, "backup-state.json"), json({ version: 1, entries }), "utf8")
}

async function restoreUpdateBackup(directory, backup, addedRelatives = []) {
  for (const relative of addedRelatives) {
    const target = path.join(directory, relative)
    if (existsSync(target)) await rm(target, { force: true, recursive: true })
  }
  const state = await readJson(path.join(backup, "backup-state.json"))
  for (const [relative, entry] of Object.entries(state.entries || {})) {
    const target = path.join(directory, relative)
    if (existsSync(target)) await rm(target, { force: true, recursive: true })
    if (entry.exists) {
      await mkdir(path.dirname(target), { recursive: true })
      await cp(path.join(backup, relative), target)
    }
  }
}

function updateReportText(report, heading = "Core update") {
  console.log(heading)
  console.log(`Updated: ${report.updated.length}`)
  console.log(`Added: ${report.added.length}`)
  console.log(`Removed: ${report.removed.length}`)
  console.log(`Preserved: ${report.preserved.length}`)
  if (report.backup) console.log(`Backup: ${report.backup}`)
  for (const item of report.conflicts || []) console.log(`Conflict: ${item}`)
  for (const item of report.errors || []) console.log(`Error: ${item}`)
  if (report.rollback) console.log(`Rollback: ${report.rollback}`)
  if (report.dryRun) for (const item of [...report.updated, ...report.added, ...report.removed]) console.log(`  ${item}`)
}

async function validateUpdatedConsumer(directory, source, expectedManifest) {
  const actual = await managedFilesForConsumer(directory, source)
  const missing = [...source.keys()].filter((relative) => !actual[relative])
  const changed = [...source.keys()].filter((relative) => actual[relative] && actual[relative].hash !== hash(source.get(relative)))
  if (missing.length || changed.length) throw new Error(`Post-update managed file validation failed${missing.length ? `; missing: ${missing.join(", ")}` : ""}${changed.length ? `; changed: ${changed.join(", ")}` : ""}.`)
  const packageJson = await readJson(path.join(directory, "package.json"))
  const packageDriftItems = packageDrift(packageJson, expectedManifest.packageVersions)
  if (packageDriftItems.length) throw new Error(`Post-update package validation failed: ${packageDriftItems.map((item) => item.name).join(", ")}.`)
  const paths = localPathValues(packageJson)
  if (paths.length) throw new Error(`Post-update portability validation failed: ${paths.map((item) => `${item.name}=${item.value}`).join(", ")}.`)
  for (const relative of ["product.catalog.json", "lib/product-config.ts", "src/product/domain.ts"]) if (!existsSync(path.join(directory, relative))) throw new Error(`Post-update product-owned file is missing: ${relative}.`)
  if (productConfigValid(directory).status === "ERROR") throw new Error("Post-update product catalog validation failed.")
  const manifest = await readJson(path.join(directory, ".saas-core-manifest.json"))
  if (manifest.coreVersion !== VERSION || manifest.schemaVersion !== SCHEMA_VERSION) throw new Error("Post-update manifest compatibility validation failed.")
}

async function update(options) {
  let directoryValue = options.positional[0]
  let targetVersion = options.to || VERSION
  if (directoryValue && /^\d+\.\d+\.\d+$/.test(directoryValue)) { targetVersion = directoryValue; directoryValue = "." }
  const directory = targetDirectory(directoryValue)
  if (targetVersion !== VERSION) throw new Error(`Core ${targetVersion} is not available in this distribution.`)
  const manifest = readManifestSync(directory)
  if (!manifest) throw new Error("Missing or invalid .saas-core-manifest.json")
  const sourceRoot = resolveTemplateRoot(options.source)
  const coreSourceCommit = options.source ? sourceGitCommit(sourceRoot) : null
  const productOwnedPaths = manifestProductOwnedPaths(manifest)
  const source = await templateManagedFiles(sourceRoot, productOwnedPaths)
  const previous = manifest.managedFiles || {}
  const additions = []
  const replacements = []
  const removals = []
  const conflicts = []
  const backupName = new Date().toISOString().replace(/[:.]/g, "-")
  const backup = path.join(directory, ".saas-core-backups", backupName)
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
    if (source.has(relative) || isProductOwned(relative, productOwnedPaths)) continue
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
  const provenanceChanged = Boolean(coreSourceCommit && manifest.coreSourceCommit !== coreSourceCommit)
  const changed = additions.length + replacements.length + removals.length + (packageChanged ? 1 : 0) + (provenanceChanged ? 1 : 0)
  const report = { dryRun: options.dryRun, targetVersion, updated: [...replacements, ...(packageChanged ? ["package.json"] : [])], added: additions, removed: removals, preserved: conflicts, conflicts, provenance: coreSourceCommit, manifestChanged: provenanceChanged, backup: null }
  if (!options.dryRun && conflicts.length) {
    report.errors = ["Update blocked because locally modified Core-managed files require an explicit merge."]
  } else if (!options.dryRun && changed > 0) {
    const backupFiles = [...new Set([...replacements, ...removals, "package.json", ".saas-core-manifest.json"])]
    await verifyUpdatePaths(directory, [...additions, ...replacements, ...removals, ...backupFiles])
    let mutationStarted = false
    let backupCreated = false
    try {
      await createUpdateBackup(directory, backup, backupFiles)
      backupCreated = true
      let mutationCount = 0
      const writeApplied = async (relative, content) => {
        const current = path.join(directory, relative)
        await mkdir(path.dirname(current), { recursive: true })
        await writeFile(current, content, "utf8")
        mutationStarted = true
        mutationCount += 1
        if (process.env.SAAS_CORE_TEST_FAIL_AFTER_MUTATION === "1" && mutationCount === 1) throw new Error("Injected update failure after first mutation.")
      }
      for (const relative of additions) await writeApplied(relative, source.get(relative))
      for (const relative of replacements) await writeApplied(relative, source.get(relative))
      for (const relative of removals) {
        await rm(path.join(directory, relative))
        mutationStarted = true
        mutationCount += 1
        if (process.env.SAAS_CORE_TEST_FAIL_AFTER_MUTATION === "1" && mutationCount === 1) throw new Error("Injected update failure after first mutation.")
      }
      if (packageChanged) {
        const currentPackage = await readJson(packageFile)
        await writeApplied("package.json", json(mergeCoreDependencies(currentPackage, corePackageVersions())))
      }
      const managedFiles = await managedFilesForConsumer(directory, source)
      const nextManifest = { ...manifest, coreVersion: VERSION, schemaVersion: SCHEMA_VERSION, packageVersions: corePackageVersions(), templateVersion: VERSION, productOwnedPaths, managedFiles, generatedAt: new Date().toISOString() }
      if (coreSourceCommit) nextManifest.coreSourceCommit = coreSourceCommit
      await writeApplied(".saas-core-manifest.json", json(nextManifest))
      await validateUpdatedConsumer(directory, source, { ...manifest, packageVersions: corePackageVersions() })
      report.backup = backup
    } catch (error) {
      report.errors = [`Update failed: ${error instanceof Error ? error.message : String(error)}`]
      if (backupCreated) report.backup = backup
      if (mutationStarted && backupCreated) {
        try {
          await restoreUpdateBackup(directory, backup, additions)
          report.rollback = "succeeded"
        } catch (rollbackError) {
          report.rollback = `FAILED: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          report.errors.push(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
        }
      } else {
        report.rollback = "not-needed; no mutation started"
      }
    }
  }
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else updateReportText(report, options.dryRun ? "Dry-run update" : report.errors?.length ? "Core update failed" : conflicts.length ? "Core update blocked by conflicts" : "Core update completed")
  if (conflicts.length || report.errors?.length) process.exitCode = 2
}

function help() { console.log("Usage: saas-core <init|doctor|diff|update> [directory] [--dry-run] [--json] [--source <core-repository-or-template>] [--to <version>]") }

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
