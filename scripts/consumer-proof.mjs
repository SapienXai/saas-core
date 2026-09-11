import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { chromium } from "@playwright/test"
import { RELEASE_VERSION, RUNTIME_PACKAGES, SCHEMA_VERSION, TOOLING_PACKAGES } from "./release-constants.mjs"

const root = process.cwd()
const packageCli = path.join(root, "packages/cli/bin/saas-core.mjs")
const artifacts = path.join(root, "artifacts")
const LEGACY_VERSION = "2.2.0"
const billingMigration = "supabase/migrations/20260909094344_reusable_billing_persistence.sql"
const runtimePackages = RUNTIME_PACKAGES
const toolingPackages = TOOLING_PACKAGES
const npmCache = mkdtempSync(path.join(os.tmpdir(), "saas-core-npm-cache-"))
const product = mkdtempSync(path.join(os.tmpdir(), "saas-core-product-"))
const packedProduct = mkdtempSync(path.join(os.tmpdir(), "saas-core-packed-product-"))
const relocatedParent = mkdtempSync(path.join(os.tmpdir(), "saas-core-relocated-"))
const relocated = path.join(relocatedParent, "product")
const registryOutput = path.join(npmCache, "registry.url")
const registryProcess = spawn(process.execPath, [path.join(root, "scripts/local-package-registry.mjs"), artifacts, registryOutput], { stdio: "ignore" })
for (let attempt = 0; attempt < 50 && !existsSync(registryOutput); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
if (!existsSync(registryOutput)) throw new Error("Disposable package registry did not start.")
const registryUrl = readFileSync(registryOutput, "utf8").trim()
const npmEnvironment = { ...process.env, npm_config_cache: npmCache, npm_config_audit: "false", npm_config_fund: "false" }

function run(command, args, cwd, extraEnvironment = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...npmEnvironment, ...extraEnvironment }, stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status ?? "unknown status"}`)
}

function runOutput(command, args, cwd, extraEnvironment = {}, expectedStatus = 0) {
  const result = spawnSync(command, args, { cwd, env: { ...npmEnvironment, ...extraEnvironment }, encoding: "utf8" })
  if (result.status !== expectedStatus) throw new Error(`${command} ${args.join(" ")} failed with ${result.status ?? "unknown status"}: ${result.stderr || result.stdout}`)
  return result.stdout
}

function removeBuildOutputs(directory) {
  for (const name of [".next", ".next-e2e"]) rmSync(path.join(directory, name), { recursive: true, force: true })
}

function downgradeToLegacyConsumer(directory, agentSurfaceFiles) {
  const packageFile = path.join(directory, "package.json")
  const packageJson = JSON.parse(readFileSync(packageFile, "utf8"))
  for (const name of runtimePackages) packageJson.dependencies[name] = `^${LEGACY_VERSION}`
  for (const name of toolingPackages) packageJson.devDependencies[name] = `^${LEGACY_VERSION}`
  writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")

  const manifestFile = path.join(directory, ".saas-core-manifest.json")
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  manifest.coreVersion = LEGACY_VERSION
  manifest.templateVersion = LEGACY_VERSION
  manifest.schemaVersion = SCHEMA_VERSION
  manifest.packageVersions = Object.fromEntries([...runtimePackages, ...toolingPackages].map((name) => [name, `^${LEGACY_VERSION}`]))
  for (const relative of agentSurfaceFiles) {
    rmSync(path.join(directory, relative), { force: true })
    delete manifest.managedFiles[relative]
  }
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
}

const packedExportProbe = `
import { readFileSync } from "node:fs"
import * as core from "@sapienx/saas-core"
import { defineProductConfig } from "@sapienx/saas-core-config"
for (const name of ["defineAgentTool", "validateAgentToolDefinition", "validateAgentToolDefinitions"]) {
  if (typeof core[name] !== "function") throw new Error("Missing packed runtime export: " + name)
}
if (core.CORE_VERSION !== "${RELEASE_VERSION}" || core.CORE_SCHEMA_VERSION !== "${SCHEMA_VERSION}") throw new Error("Packed Core version metadata is incorrect.")
core.validateAgentToolDefinitions([])
if (core.BILLING_INTERVALS.join(",") !== "month,year" || core.getBillingProrationMode("upgrade") !== "immediate" || core.getBillingProrationMode("downgrade") !== "next_period") throw new Error("Packed billing interval or proration contract is incorrect.")
if (core.resolveBillingRetry({ outcome: "unknown" }) !== "reconcile") throw new Error("Packed billing unknown-outcome contract is incorrect.")
if (core.resolveEffectiveBillingPlan({ status: "canceled", purchasedPlanKey: "paid", fallbackPlanKey: "free" }) !== "free") throw new Error("Packed billing fallback contract is incorrect.")
const packedProductConfig = defineProductConfig({
  identity: { name: "Packed Proof", slug: "packed-proof" },
  capabilities: { billing: true },
  catalog: { defaultPlanKey: "starter", plans: [{ key: "starter", name: "Starter", features: { exports: true }, limits: { "core.workspaces": 1 } }], usageMetrics: [] },
  billing: { defaultPlanKey: "starter", fallbackPlanKey: "starter", supportedIntervals: ["month", "year"], defaultInterval: "month", presentation: { planOrder: ["starter"], copy: { title: "Choose a plan" } } },
})
if (packedProductConfig.billing?.defaultPlanKey !== "starter") throw new Error("Packed product billing configuration contract is incorrect.")
const declarations = readFileSync(new URL("./index.d.ts", await import.meta.resolve("@sapienx/saas-core")), "utf8")
const billingDeclarations = readFileSync(new URL("./billing.d.ts", await import.meta.resolve("@sapienx/saas-core")), "utf8")
for (const name of ["JsonSchema", "AgentToolDefinition", "AgentSurfaceEvent", "AgentSurfaceObserver"]) {
  if (!declarations.includes("export type " + name)) throw new Error("Missing packed type export: " + name)
}
for (const name of ["ProductBillingPolicy", "BillingOperationOutcome", "BillingTransitionDecision"]) {
  if (!billingDeclarations.includes("export type " + name)) throw new Error("Missing packed billing type export: " + name)
}
`

function localSupabaseEnvironment() {
  try {
    const result = spawnSync("supabase", ["status", "--workdir", root, "-o", "json"], { encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } })
    const output = result.stdout || ""
    const jsonStart = output.indexOf("{")
    const jsonEnd = output.lastIndexOf("}")
    if (jsonStart < 0 || jsonEnd < jsonStart) return null
    const status = JSON.parse(output.slice(jsonStart, jsonEnd + 1))
    if (!/^https?:\/\/(127\.0\.0\.1|localhost):55621$/.test(status.API_URL || "") || !status.SERVICE_ROLE_KEY) return null
    return {
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_URL: status.API_URL,
      SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      SUPABASE_JWT_SECRET: status.JWT_SECRET,
      SAAS_CORE_MAIL_URL: status.INBUCKET_URL || "http://127.0.0.1:55624",
      NEXT_PUBLIC_DEV_MAILPIT_URL: status.INBUCKET_URL || "http://127.0.0.1:55624",
    }
  } catch {
    return null
  }
}

async function configuredShellBrowserProof(port, supabaseEnvironment) {
  if (!supabaseEnvironment) return false
  if (!existsSync(chromium.executablePath())) {
    console.warn("Configured-shell browser proof skipped: Playwright Chromium is not installed.")
    return false
  }
  const service = createClient(supabaseEnvironment.SUPABASE_URL, supabaseEnvironment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const password = "CoreConsumer!2026-password"
  const email = `consumer-shell-${Date.now()}-${process.pid}@example.test`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error || new Error("Could not create the configured-shell consumer proof account.")
  let workspaceId = ""
  const client = createClient(supabaseEnvironment.SUPABASE_URL, supabaseEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const session = await client.auth.signInWithPassword({ email, password })
  if (session.error) throw session.error
  const bootstrap = await client.rpc("bootstrap_initial_workspace", { target_workspace_name: "Projects Shell Proof", target_workspace_slug: `projects-shell-${Date.now()}` })
  if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Could not bootstrap the configured-shell consumer workspace.")
  workspaceId = bootstrap.data[0].workspace_id
  await client.auth.signOut()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 900 } })
    await page.goto("/login")
    await page.locator("#login-email").fill(email)
    await page.locator("#login-password").fill(password)
    await page.getByRole("button", { name: "Sign in" }).click()
    try {
      await page.waitForURL(/\/(onboarding|app)/, { timeout: 30_000 })
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Current URL: ${page.url()}. Page: ${(await page.locator("body").innerText()).slice(0, 1000)}`)
    }
    await page.waitForURL(/\/app\/projects(?:\?|$)/, { timeout: 30_000 })
    await page.getByRole("heading", { name: "Projects home", exact: true }).waitFor({ state: "visible" })
    const resourcesLink = page.getByRole("link", { name: "Resources", exact: true })
    try {
      await resourcesLink.waitFor({ state: "visible", timeout: 10_000 })
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Configured product navigation was not rendered in the desktop shell. Page: ${(await page.locator("body").innerText()).slice(0, 2000)}`)
    }
    await resourcesLink.click()
    await page.waitForURL(/\/app\/resources(?:\?|$)/, { timeout: 30_000 })
    if (!(await page.getByRole("main").getByRole("heading", { name: "Resources", exact: true }).isVisible())) throw new Error("Configured product navigation did not navigate to its product route.")

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/app/projects")
    await page.getByRole("button", { name: "Open navigation" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("link", { name: "Resources", exact: true }).waitFor({ state: "visible" })
    await dialog.getByRole("button", { name: "Close navigation" }).click()
    return true
  } finally {
    await browser.close()
    if (workspaceId) await service.from("workspaces").delete().eq("id", workspaceId)
    await service.auth.admin.deleteUser(created.data.user.id)
  }
}

async function bootAndSmoke(cwd, port, configured = false, supabaseEnvironment = null) {
  const diagnostics = []
  let browserShell = false
  const serverArgs = configured && supabaseEnvironment ? ["run", "dev", "--", "--port", String(port)] : ["run", "start", "--", "-p", String(port)]
  const server = spawn("npm", serverArgs, { cwd, env: { ...npmEnvironment, ...(supabaseEnvironment || {}) }, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => diagnostics.push(String(chunk)))
  server.stderr.on("data", (chunk) => diagnostics.push(String(chunk)))
  try {
    let ready = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`)
        if (response.status < 500) {
          ready = true
          break
        }
      } catch {
        // Next is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!ready) throw new Error(`Generated consumer did not boot on port ${port}.\n${diagnostics.join("").slice(-4000)}`)
    for (const pathname of ["/", "/login", "/signup", "/forgot-password", "/manifest.webmanifest"]) {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`)
      if (response.status >= 500) throw new Error(`Generated consumer returned ${response.status} for ${pathname}.`)
    }
    if (configured && supabaseEnvironment) browserShell = await configuredShellBrowserProof(port, supabaseEnvironment)
    else if (configured) console.warn("Configured-shell browser proof skipped: the isolated local Supabase project is not running.")
    return browserShell
  } finally {
    server.kill("SIGTERM")
  }
}

try {
  run(process.execPath, [packageCli, "init", "Projects Proof", product], root)
  const productConfigFile = path.join(product, "lib/product-config.ts")
  const productConfig = readFileSync(productConfigFile, "utf8").replace(
    "  catalog: productCatalog,",
    "  shell: { homePath: \"/app/projects\", homeLabel: \"Projects\", navigation: [{ key: \"resources\", label: \"Resources\", href: \"/app/resources\", icon: \"folder\", match: \"prefix\" }] },\n  catalog: productCatalog,",
  )
  writeFileSync(productConfigFile, productConfig, "utf8")
  mkdirSync(path.join(product, "app/(product)/app/projects"), { recursive: true })
  mkdirSync(path.join(product, "app/(product)/app/resources"), { recursive: true })
  writeFileSync(path.join(product, "app/(product)/app/layout.tsx"), 'export { default, generateMetadata, generateViewport } from "@/app/manage/layout"\n', "utf8")
  writeFileSync(path.join(product, "app/(product)/app/projects/page.tsx"), 'export default function ProjectsHome() { return <div><h2>Projects home</h2><p>Product-owned workspace home.</p></div> }\n', "utf8")
  writeFileSync(path.join(product, "app/(product)/app/resources/page.tsx"), 'export default function ResourcesPage() { return <div><h2>Resources</h2><p>Product-owned workspace resource list.</p></div> }\n', "utf8")
  const generatedCatalog = JSON.parse(readFileSync(path.join(product, "product.catalog.json"), "utf8"))
  if (generatedCatalog.defaultPlanKey !== "default" || generatedCatalog.plans.length !== 1 || generatedCatalog.plans[0].key !== "default" || generatedCatalog.plans[0].prices) throw new Error("Generated consumer did not receive the neutral product-owned starter catalog.")
  const generatedSeed = readFileSync(path.join(product, "supabase/seed.sql"), "utf8")
  if (!generatedSeed.includes("'default'") || !generatedSeed.includes("'{\"core.workspaces\":1,\"core.members\":null}'::jsonb")) throw new Error("Generated consumer seed does not bootstrap the neutral default plan and its explicit workspace limit.")
  const generatedPackage = JSON.parse(readFileSync(path.join(product, "package.json"), "utf8"))
  if (generatedPackage.dependencies["@sapienx/saas-core-cli"] || generatedPackage.dependencies["@sapienx/saas-core-app"]) throw new Error("Tooling/template-only Core packages were emitted as runtime dependencies.")
  if (generatedPackage.devDependencies["@sapienx/saas-core-cli"] !== `^${RELEASE_VERSION}`) throw new Error(`Core CLI was not emitted as a ${RELEASE_VERSION} tooling dependency.`)
  for (const name of ["@sapienx/saas-core", "@sapienx/saas-core-config", "@sapienx/saas-core-ui"]) if (!generatedPackage.dependencies[name]) throw new Error(`Missing runtime Core dependency: ${name}`)
  const agentSurfaceFiles = ["components/agent-surface/core-webmcp-tools.tsx", "lib/agent-surface/server.ts", "lib/agent-surface/webmcp.ts"]
  const billingManagedFiles = [
    billingMigration,
    "app/api/billing/paddle/webhook/route.ts",
    "app/api/cron/billing/lifecycle/route.ts",
    "app/manage/plan/actions.ts",
    "app/manage/plan/page.tsx",
    "app/platform/billing/page.tsx",
    "components/manage/billing-success-experience.tsx",
    "components/manage/paddle-billing-actions.tsx",
    "components/manage/plan-feature-preview.tsx",
    "components/manage/scheduled-plan-change-banner.tsx",
    "lib/billing/lifecycle.ts",
    "lib/billing/paddle-client.ts",
    "lib/billing/persistence.ts",
    "lib/billing/price-mapping.ts",
    "lib/billing/reconciliation.ts",
    "lib/billing/webhook.ts",
    "lib/entitlements.ts",
  ]
  for (const relative of agentSurfaceFiles) if (!existsSync(path.join(product, relative))) throw new Error(`Fresh consumer is missing Agent Surface file: ${relative}`)
  for (const relative of billingManagedFiles) if (!existsSync(path.join(product, relative))) throw new Error(`Fresh consumer is missing managed billing file: ${relative}`)
  const freshManifest = JSON.parse(readFileSync(path.join(product, ".saas-core-manifest.json"), "utf8"))
  if (!freshManifest.managedFiles[billingMigration]) throw new Error("Fresh consumer manifest did not record the reusable billing migration as Core-managed.")
  const productMigrationRelative = "supabase/migrations/product/20990909000000_product-owned-proof.sql"
  mkdirSync(path.dirname(path.join(product, productMigrationRelative)), { recursive: true })
  const productMigration = "-- Product-owned migration fixture\ncreate table if not exists public.product_owned_proof (id uuid primary key);\n"
  writeFileSync(path.join(product, productMigrationRelative), productMigration, "utf8")
  run(process.execPath, [packageCli, "doctor", product], root)
  const supabaseEnvironment = localSupabaseEnvironment()
  writeFileSync(path.join(product, ".npmrc"), `registry=https://registry.npmjs.org/\n@sapienx:registry=${registryUrl}\n`, "utf8")
  run("npm", ["install", "--ignore-scripts", "--audit=false", "--fund=false"], product)
  const installedCli = path.join(product, "node_modules/.bin/saas-core")
  if (!existsSync(installedCli)) throw new Error("Packed Core CLI was not installed in the generated consumer.")
  run(installedCli, ["doctor", product], product)
  run(process.execPath, ["--input-type=module", "-e", packedExportProbe], product)
  run(installedCli, ["init", "Packed CLI Proof", packedProduct], product)
  for (const relative of agentSurfaceFiles) if (!existsSync(path.join(packedProduct, relative))) throw new Error(`Packed CLI consumer is missing Agent Surface file: ${relative}`)
  for (const relative of billingManagedFiles) if (!existsSync(path.join(packedProduct, relative))) throw new Error(`Packed CLI consumer is missing managed billing file: ${relative}`)
  run(installedCli, ["doctor", packedProduct], packedProduct)
  const legacyThemeFile = path.join(packedProduct, "styles/product-theme.css")
  const legacyTheme = `${readFileSync(legacyThemeFile, "utf8")}\n:root { --legacy-upgrade-proof: #123456; }\n`
  writeFileSync(legacyThemeFile, legacyTheme, "utf8")
  mkdirSync(path.dirname(path.join(packedProduct, productMigrationRelative)), { recursive: true })
  writeFileSync(path.join(packedProduct, productMigrationRelative), productMigration, "utf8")
  downgradeToLegacyConsumer(packedProduct, [...agentSurfaceFiles, ...billingManagedFiles])
  const legacyDiff = JSON.parse(runOutput(installedCli, ["diff", packedProduct, "--json"], packedProduct, {}, 2))
  if (!legacyDiff.versionDrift.includes(`Core version ${LEGACY_VERSION} → ${RELEASE_VERSION}`)) throw new Error("Packed CLI did not report the legacy runtime upgrade.")
  if (legacyDiff.schemaDrift.length || legacyDiff.packageDrift.length !== 4 || legacyDiff.packageDrift.some((item) => item.actual !== `^${LEGACY_VERSION}` || item.expected !== `^${RELEASE_VERSION}`)) throw new Error("Packed CLI did not report the legacy package movement while preserving schema 2.0.")
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) if (!legacyDiff.coreDrift.includes(`A ${relative}`)) throw new Error(`Packed CLI legacy diff omitted managed billing/surface addition ${relative}.`)
  const legacyDryRun = JSON.parse(runOutput(installedCli, ["update", packedProduct, "--dry-run", "--json"], packedProduct))
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) if (!legacyDryRun.added.includes(relative)) throw new Error(`Packed CLI legacy dry-run omitted managed billing/surface addition ${relative}.`)
  if (!legacyDryRun.updated.includes("package.json")) throw new Error("Packed CLI legacy dry-run omitted the package version movement.")
  const legacyApply = JSON.parse(runOutput(installedCli, ["update", packedProduct, "--json"], packedProduct))
  if (JSON.stringify(legacyApply.updated) !== JSON.stringify(legacyDryRun.updated) || JSON.stringify(legacyApply.added) !== JSON.stringify(legacyDryRun.added) || JSON.stringify(legacyApply.removed) !== JSON.stringify(legacyDryRun.removed)) throw new Error("Packed CLI legacy dry-run plan did not match the real update plan.")
  const upgradedLegacyManifest = JSON.parse(readFileSync(path.join(packedProduct, ".saas-core-manifest.json"), "utf8"))
  if (upgradedLegacyManifest.coreVersion !== RELEASE_VERSION || upgradedLegacyManifest.schemaVersion !== SCHEMA_VERSION || Object.values(upgradedLegacyManifest.packageVersions).some((value) => value !== `^${RELEASE_VERSION}`)) throw new Error(`Packed legacy consumer manifest was not upgraded to Core ${RELEASE_VERSION} / schema ${SCHEMA_VERSION}.`)
  const upgradedLegacyPackage = JSON.parse(readFileSync(path.join(packedProduct, "package.json"), "utf8"))
  if (runtimePackages.some((name) => upgradedLegacyPackage.dependencies[name] !== `^${RELEASE_VERSION}`) || toolingPackages.some((name) => upgradedLegacyPackage.devDependencies[name] !== `^${RELEASE_VERSION}`)) throw new Error(`Packed legacy consumer package.json was not upgraded to ^${RELEASE_VERSION}.`)
  if (readFileSync(legacyThemeFile, "utf8") !== legacyTheme) throw new Error("Packed legacy update overwrote the product-owned theme.")
  if (readFileSync(path.join(packedProduct, productMigrationRelative), "utf8") !== productMigration) throw new Error("Packed consumer update changed a product-owned migration.")
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) if (!existsSync(path.join(packedProduct, relative))) throw new Error(`Packed legacy update did not restore managed file: ${relative}`)
  writeFileSync(path.join(packedProduct, ".npmrc"), `registry=https://registry.npmjs.org/\n@sapienx:registry=${registryUrl}\n`, "utf8")
  run("npm", ["install", "--ignore-scripts", "--audit=false", "--fund=false"], packedProduct)
  const legacyInstalledCli = path.join(packedProduct, "node_modules/.bin/saas-core")
  run(legacyInstalledCli, ["doctor", packedProduct], packedProduct)
  run(process.execPath, ["--input-type=module", "-e", packedExportProbe], packedProduct)
  run("npm", ["run", "typecheck"], packedProduct)
  run("npm", ["test"], packedProduct)
  run("npm", ["run", "build"], packedProduct, supabaseEnvironment || {})
  removeBuildOutputs(packedProduct)
  rmSync(path.join(packedProduct, "node_modules"), { recursive: true, force: true })
  run("npm", ["test"], product)
  run("npm", ["run", "typecheck"], product)
  run("npm", ["run", "build"], product, supabaseEnvironment || {})
  const browserShell = await bootAndSmoke(product, 3217, true, supabaseEnvironment)
  removeBuildOutputs(product)
  renameSync(product, relocated)

  const relocatedCli = path.join(relocated, "node_modules/.bin/saas-core")
  run(relocatedCli, ["diff", relocated], relocated)
  run(relocatedCli, ["update", relocated, "--dry-run"], relocated)
  rmSync(path.join(relocated, "node_modules"), { recursive: true, force: true })
  run("npm", ["ci", "--ignore-scripts", "--audit=false", "--fund=false"], relocated)
  if (!existsSync(relocatedCli)) throw new Error("Packed Core CLI was not restored by frozen install.")
  if (!existsSync(path.join(relocated, billingMigration))) throw new Error("Relocation or frozen install lost the reusable billing migration.")
  run(relocatedCli, ["doctor", relocated], relocated)
  run("npm", ["test"], relocated)
  run("npm", ["run", "build"], relocated, supabaseEnvironment || {})
  const relocatedBrowserShell = await bootAndSmoke(relocated, 3218, true, supabaseEnvironment)
  removeBuildOutputs(relocated)
  run(relocatedCli, ["update", relocated], relocated)
  run(relocatedCli, ["doctor", relocated], relocated)
  const packageJson = JSON.parse(readFileSync(path.join(relocated, "package.json"), "utf8"))
  const persistedPackage = JSON.stringify(packageJson)
  if (/file:|link:|workspace:|registry\.url|\/Users\/|\/private\//.test(persistedPackage) || persistedPackage.includes(root)) throw new Error("Generated consumer contains a local dependency path.")
  console.log(JSON.stringify({ status: "PASS", product: relocated, install: "packed Core through local registry", packedExports: true, packedBillingContract: true, freshConsumer: `${RELEASE_VERSION} / schema ${SCHEMA_VERSION}`, legacyConsumerUpgrade: `${LEGACY_VERSION} -> ${RELEASE_VERSION}`, billingManagedUpdate: true, legacyProductOwnedPreserved: true, legacyTypecheck: true, legacyTests: true, legacyBuild: true, configuredShell: true, browserShell: browserShell && relocatedBrowserShell, relocation: true, frozenInstall: true }))
} finally {
  registryProcess.kill("SIGTERM")
  rmSync(product, { recursive: true, force: true })
  rmSync(packedProduct, { recursive: true, force: true })
  rmSync(relocatedParent, { recursive: true, force: true })
  rmSync(npmCache, { recursive: true, force: true })
}
