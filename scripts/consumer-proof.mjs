import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { chromium } from "@playwright/test"
import { RELEASE_VERSION, RUNTIME_PACKAGES, SCHEMA_VERSION, TOOLING_PACKAGES } from "./release-constants.mjs"

const root = process.cwd()
const packageCli = path.join(root, "packages/cli/bin/saas-core.mjs")
const supabaseBinary = path.join(root, "node_modules/.bin/supabase")
const artifacts = path.join(root, "artifacts")
const LEGACY_VERSION = "2.2.0"
const billingMigrations = [
  "supabase/migrations/20260909094344_reusable_billing_persistence.sql",
  "supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql",
  "supabase/migrations/20260914100000_reusable_plan_catalog_management.sql",
  "supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql",
  "supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql",
  "supabase/migrations/20260915090000_fix_invalid_scheduled_downgrade_fail_closed.sql",
  "supabase/migrations/20260915120000_scheduled_provider_price_trust.sql",
  "supabase/migrations/20260916120000_saas_core_domain_foundation_v1.sql",
]
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

function configureDisposableSupabase(directory, label, portBase) {
  const configFile = path.join(directory, "supabase/config.toml")
  const projectId = `saas-core-${label}-${process.pid}-${Date.now()}`.replace(/[^a-z0-9_-]/gi, "-").slice(0, 63)
  let config = readFileSync(configFile, "utf8").replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`)
  config = config
    .replace(/^port = 55521$/m, `port = ${portBase + 1}`)
    .replace(/^port = 55522$/m, `port = ${portBase + 2}`)
    .replace(/^shadow_port = 55520$/m, `shadow_port = ${portBase}`)
    .replace(/^port = 54329$/m, `port = ${portBase + 9}`)
    .replace(/^port = 55523$/m, `port = ${portBase + 3}`)
    .replace(/^port = 55524$/m, `port = ${portBase + 4}`)
    .replace(/^inspector_port = 55528$/m, `inspector_port = ${portBase + 8}`)
    .replace(/^port = 55527$/m, `port = ${portBase + 7}`)
  writeFileSync(configFile, config, "utf8")
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)))
  })
}

async function findDisposablePortBase() {
  for (let base = 56000; base < 56900; base += 10) {
    const ports = [base, base + 1, base + 2, base + 3, base + 4, base + 9]
    if ((await Promise.all(ports.map((port) => isPortAvailable(port)))).every(Boolean)) return base
  }
  throw new Error("Could not find an available disposable Supabase port block.")
}

function startDisposableSupabase(directory) {
  run(supabaseBinary, ["start", "--workdir", directory], directory, { SUPABASE_TELEMETRY_DISABLED: "1" })
}

function stopDisposableSupabase(directory) {
  if (!existsSync(path.join(directory, "supabase/config.toml"))) return
  spawnSync(supabaseBinary, ["stop", "--workdir", directory], {
    cwd: directory,
    env: { ...npmEnvironment, SUPABASE_TELEMETRY_DISABLED: "1" },
    stdio: "ignore",
  })
}

function disposableSupabaseStatus(directory) {
  const result = spawnSync(supabaseBinary, ["status", "--workdir", directory, "-o", "json"], {
    cwd: directory,
    env: { ...npmEnvironment, SUPABASE_TELEMETRY_DISABLED: "1" },
    encoding: "utf8",
  })
  if (result.status !== 0) throw new Error(`Could not read disposable Supabase status: ${result.stderr || result.stdout}`)
  const output = result.stdout || ""
  const start = output.indexOf("{")
  const end = output.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error(`Disposable Supabase status was not JSON: ${output}`)
  return JSON.parse(output.slice(start, end + 1))
}

async function assertDisposableSchema(directory, productTables) {
  const status = disposableSupabaseStatus(directory)
  if (!status.API_URL || !status.SERVICE_ROLE_KEY) throw new Error("Disposable Supabase status did not include an API URL and service-role key.")
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  for (const table of ["workspaces", ...productTables]) {
    const result = await service.from(table).select("*", { count: "exact", head: true })
    if (result.error) throw new Error(`Disposable Supabase schema is missing ${table}: ${result.error.message}`)
  }
  return status
}

function removeBuildOutputs(directory) {
  for (const name of [".next", ".next-e2e"]) rmSync(path.join(directory, name), { recursive: true, force: true })
}

function assertConsumerIgnore(directory) {
  const file = path.join(directory, ".gitignore")
  if (!existsSync(file)) throw new Error(`Generated consumer is missing its .gitignore: ${directory}`)
  const content = readFileSync(file, "utf8")
  for (const phrase of [".next/", ".playwright-cli/", "supabase/.temp/", "*.tgz", "!.env.example"]) {
    if (!content.includes(phrase)) throw new Error(`Generated consumer .gitignore is missing ${phrase}: ${directory}`)
  }
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

function signalProcessTree(child, signal) {
  if (!child.pid || !isRunning(child)) return

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" })
    if (result.status !== 0 && isRunning(child)) {
      try {
        child.kill(signal)
      } catch {
        // The process may have exited between taskkill and the fallback.
      }
    }
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        child.kill(signal)
      } catch {
        // The process may have exited between the group and child signals.
      }
    }
  }
}

async function stopProcessTree(child) {
  if (!isRunning(child)) {
    child.stdout?.destroy()
    child.stderr?.destroy()
    return
  }

  const closed = new Promise((resolve) => child.once("close", resolve))
  signalProcessTree(child, "SIGTERM")
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5_000))])

  if (isRunning(child)) {
    signalProcessTree(child, "SIGKILL")
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5_000))])
  }

  child.stdout?.destroy()
  child.stderr?.destroy()
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
import * as coreUi from "@sapienx/saas-core-ui"
import { defineProductConfig } from "@sapienx/saas-core-config"
for (const name of ["defineAgentTool", "validateAgentToolDefinition", "validateAgentToolDefinitions", "evaluateEntitlementConsumption", "getUsageSnapshot", "getEntitlementGateState", "isProductPlanKey", "isCoreProductKey", "validatePlanDefinition", "normalizeProductPlan", "classifyProductPlanChange", "duplicateProductPlan"]) {
  if (typeof core[name] !== "function") throw new Error("Missing packed runtime export: " + name)
}
if (core.CORE_VERSION !== "${RELEASE_VERSION}" || core.CORE_SCHEMA_VERSION !== "${SCHEMA_VERSION}") throw new Error("Packed Core version metadata is incorrect.")
if (coreUi.UI_SYSTEM_VERSION !== "${RELEASE_VERSION}" || typeof coreUi.BillingUsageMeter !== "function" || typeof coreUi.EntitlementLimitNotice !== "function") throw new Error("Packed Core UI exports are not importable.")
core.validateAgentToolDefinitions([])
if (!core.isCoreProductKey("venue-renderer") || core.isCoreProductKey("bad key")) throw new Error("Packed public-domain product-key contract is incorrect.")
if (core.BILLING_INTERVALS.join(",") !== "month,year" || core.getBillingProrationMode("upgrade") !== "immediate" || core.getBillingProrationMode("downgrade") !== "next_period") throw new Error("Packed billing interval or proration contract is incorrect.")
if (core.resolveBillingRetry({ outcome: "unknown" }) !== "reconcile") throw new Error("Packed billing unknown-outcome contract is incorrect.")
if (core.resolveEffectiveBillingPlan({ status: "canceled", purchasedPlanKey: "paid", fallbackPlanKey: "free" }) !== "free") throw new Error("Packed billing fallback contract is incorrect.")
const packedPlan = core.normalizeProductPlan({ key: "starter", name: "Starter", limits: { seats: 2, storage_bytes: null }, prices: { month: { amount: 12, currency: "USD", providerPriceId: "provider_price" } } })
if (packedPlan.limits.seats !== 2 || packedPlan.limits.storage_bytes !== null || packedPlan.active !== true) throw new Error("Packed plan normalization contract is incorrect.")
if (core.classifyProductPlanChange(packedPlan, { ...packedPlan, name: "Starter workspaces" }) !== "presentation") throw new Error("Packed plan presentation-change contract is incorrect.")
const duplicatedPlan = core.duplicateProductPlan(packedPlan, "starter_copy")
if (duplicatedPlan.active !== false || duplicatedPlan.prices?.month?.providerPriceId !== undefined) throw new Error("Packed plan duplication contract is incorrect.")
const packedProductConfig = defineProductConfig({
  identity: { name: "Packed Proof", slug: "packed-proof" },
  capabilities: { billing: true },
  catalog: { defaultPlanKey: "starter", plans: [{ key: "starter", name: "Starter", features: { exports: true }, limits: { "core.workspaces": 1 } }], usageMetrics: [] },
  billing: { defaultPlanKey: "starter", fallbackPlanKey: "starter", supportedIntervals: ["month", "year"], defaultInterval: "month", presentation: { planOrder: ["starter"], copy: { title: "Choose a plan" } } },
})
if (packedProductConfig.billing?.defaultPlanKey !== "starter") throw new Error("Packed product billing configuration contract is incorrect.")
const declarations = readFileSync(new URL("./index.d.ts", await import.meta.resolve("@sapienx/saas-core")), "utf8")
const billingDeclarations = readFileSync(new URL("./billing.d.ts", await import.meta.resolve("@sapienx/saas-core")), "utf8")
const entitlementDeclarations = readFileSync(new URL("./entitlements.d.ts", await import.meta.resolve("@sapienx/saas-core")), "utf8")
const domainDeclarations = readFileSync(new URL("./domains.d.ts", await import.meta.resolve("@sapienx/saas-core")), "utf8")
for (const name of ["JsonSchema", "AgentToolDefinition", "AgentSurfaceEvent", "AgentSurfaceObserver"]) {
  if (!declarations.includes("export type " + name)) throw new Error("Missing packed type export: " + name)
}
for (const name of ["ProductBillingPolicy", "BillingOperationOutcome", "BillingTransitionDecision"]) {
  if (!billingDeclarations.includes("export type " + name)) throw new Error("Missing packed billing type export: " + name)
}
for (const name of ["EntitlementLimit", "EntitlementDecision", "UsageSnapshot"]) {
  if (!entitlementDeclarations.includes("export type " + name)) throw new Error("Missing packed entitlement type export: " + name)
}
for (const name of ["CoreDomain", "CorePublicSite", "CoreHostResolution", "CoreDomainService"]) {
  if (!domainDeclarations.includes("export type " + name)) throw new Error("Missing packed domain type export: " + name)
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
  const proofPlanKey = `consumer_proof_${Date.now()}_${process.pid}`
  let createdUserId = ""
  let workspaceId = ""
  let proofPlanCreated = false
  let browser = null
  try {
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data.user) throw created.error || new Error("Could not create the configured-shell consumer proof account.")
    createdUserId = created.data.user.id
    const client = createClient(supabaseEnvironment.SUPABASE_URL, supabaseEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const session = await client.auth.signInWithPassword({ email, password })
    if (session.error) throw session.error
    const bootstrap = await client.rpc("bootstrap_initial_workspace", { target_workspace_name: "Projects Shell Proof", target_workspace_slug: `projects-shell-${Date.now()}` })
    if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Could not bootstrap the configured-shell consumer workspace.")
    workspaceId = bootstrap.data[0].workspace_id
    await client.auth.signOut()
    const insertedPlan = await service.from("plans").insert({
      key: proofPlanKey,
      name: "Consumer proof",
      sort_order: 999,
      active: true,
      features: {},
      limits: { "core.workspaces": 1, "core.members": null, locations: 2, unknown_locations: 2 },
      metadata: { fixture: true },
    })
    if (insertedPlan.error) throw insertedPlan.error
    proofPlanCreated = true
    const updatedSubscription = await service.from("workspace_subscriptions").update({ plan_key: proofPlanKey, source: "manual" }).eq("workspace_id", workspaceId).select("plan_key, source").single()
    if (updatedSubscription.error || updatedSubscription.data?.plan_key !== proofPlanKey) throw updatedSubscription.error || new Error("Could not attach the disposable Plan proof subscription.")
    browser = await chromium.launch({ headless: true })
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

    await page.goto("/app/plan")
    await page.getByRole("heading", { name: "Plan and usage", exact: true }).waitFor({ state: "visible" })
    await page.getByText("Team members", { exact: true }).first().waitFor({ state: "visible" })
    await page.getByText("1 / Unlimited", { exact: true }).first().waitFor({ state: "visible" })
    await page.getByText("Locations", { exact: true }).first().waitFor({ state: "visible" })
    const planBody = await page.locator("body").innerText()
    if (!planBody.includes("1 / 2")) throw new Error(`Product usage proof did not render the expected Locations quota. Plan body: ${planBody.slice(-4000)}`)
    const unknownMetric = page.getByText("Unknown locations", { exact: true }).locator("..")
    await unknownMetric.getByText("—", { exact: true }).waitFor({ state: "visible" })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/app/projects")
    await page.getByRole("button", { name: "Open navigation" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("link", { name: "Resources", exact: true }).waitFor({ state: "visible" })
    await dialog.getByRole("button", { name: "Close navigation" }).click()
    return true
  } finally {
    if (browser) await browser.close()
    if (workspaceId) await service.from("workspaces").delete().eq("id", workspaceId)
    if (createdUserId) await service.auth.admin.deleteUser(createdUserId)
    if (proofPlanCreated) await service.from("plans").delete().eq("key", proofPlanKey)
  }
}

async function bootAndSmoke(cwd, port, configured = false, supabaseEnvironment = null) {
  const diagnostics = []
  let browserShell = false
  const serverArgs = configured && supabaseEnvironment ? ["run", "dev", "--", "--port", String(port)] : ["run", "start", "--", "-p", String(port)]
  const server = spawn("npm", serverArgs, { cwd, env: { ...npmEnvironment, ...(supabaseEnvironment || {}) }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" })
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
    await stopProcessTree(server)
  }
}

try {
  run(process.execPath, [packageCli, "init", "Projects Proof", product], root)
  assertConsumerIgnore(product)
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
  generatedCatalog.usageMetrics = [
    { key: "locations", name: "Locations" },
    { key: "unknown_locations", name: "Unknown locations" },
  ]
  generatedCatalog.plans[0].limits = { ...generatedCatalog.plans[0].limits, locations: 2, unknown_locations: 2 }
  writeFileSync(path.join(product, "product.catalog.json"), `${JSON.stringify(generatedCatalog, null, 2)}\n`, "utf8")
  const productUsageFile = path.join(product, "src/product/usage.ts")
  writeFileSync(productUsageFile, `import "server-only"\n\nimport type { UsageResolverMap } from "@/lib/entitlements"\n\nexport const PRODUCT_USAGE_RESOLVERS: UsageResolverMap = {\n  locations: async ({ db, workspaceId }) => {\n    const result = await db.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)\n    if (result.error) throw new Error(result.error.message)\n    return result.count || 0\n  },\n}\n\nexport function getProductUsageResolvers(): UsageResolverMap {\n  return PRODUCT_USAGE_RESOLVERS\n}\n`, "utf8")
  if (generatedCatalog.defaultPlanKey !== "default" || generatedCatalog.plans.length !== 1 || generatedCatalog.plans[0].key !== "default" || generatedCatalog.plans[0].prices) throw new Error("Generated consumer did not receive the neutral product-owned starter catalog.")
  if (generatedCatalog.usageMetrics.map((metric) => metric.key).join(",") !== "locations,unknown_locations" || generatedCatalog.plans[0].limits.locations !== 2) throw new Error("Generated consumer did not retain the generic product usage catalog proof.")
  const generatedSeed = readFileSync(path.join(product, "supabase/seed.sql"), "utf8")
  if (!generatedSeed.includes("'default'") || !generatedSeed.includes("'{\"core.workspaces\":1,\"core.members\":null}'::jsonb")) throw new Error("Generated consumer seed does not bootstrap the neutral default plan and its explicit workspace limit.")
  const generatedPackage = JSON.parse(readFileSync(path.join(product, "package.json"), "utf8"))
  if (generatedPackage.dependencies["@sapienx/saas-core-cli"] || generatedPackage.dependencies["@sapienx/saas-core-app"]) throw new Error("Tooling/template-only Core packages were emitted as runtime dependencies.")
  if (generatedPackage.devDependencies["@sapienx/saas-core-cli"] !== `^${RELEASE_VERSION}`) throw new Error(`Core CLI was not emitted as a ${RELEASE_VERSION} tooling dependency.`)
  for (const name of ["@sapienx/saas-core", "@sapienx/saas-core-config", "@sapienx/saas-core-ui"]) if (!generatedPackage.dependencies[name]) throw new Error(`Missing runtime Core dependency: ${name}`)
  const agentSurfaceFiles = ["components/agent-surface/core-webmcp-tools.tsx", "lib/agent-surface/server.ts", "lib/agent-surface/webmcp.ts"]
  const billingManagedFiles = [
    ...billingMigrations,
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
  const productUsageExtension = "src/product/usage.ts"
  if (!existsSync(path.join(product, productUsageExtension))) throw new Error("Fresh consumer is missing the product-owned usage resolver extension.")
  const freshManifest = JSON.parse(readFileSync(path.join(product, ".saas-core-manifest.json"), "utf8"))
  if (!freshManifest.productOwnedPaths.includes("src/product/")) throw new Error("Fresh consumer manifest does not preserve the product usage extension boundary.")
  for (const migration of billingMigrations) if (!freshManifest.managedFiles[migration]) throw new Error(`Fresh consumer manifest did not record ${migration} as Core-managed.`)
  const productMigrationRelative = "supabase/migrations/20990909000000_product-owned-proof.sql"
  const productMigrationTable = "product_owned_proof"
  const productMigration = "-- Flat Product-owned migration fixture\ncreate table if not exists public.product_owned_proof (id uuid primary key);\ngrant all on table public.product_owned_proof to service_role;\n"
  writeFileSync(path.join(product, productMigrationRelative), productMigration, "utf8")
  const nonCanonicalMigrationRelative = "supabase/migrations/foo/20990909000001_unknown-nested.sql"
  const nonCanonicalMigration = "-- Unsupported nested migration fixture; Core preserves this file without claiming native execution.\n"
  mkdirSync(path.dirname(path.join(product, nonCanonicalMigrationRelative)), { recursive: true })
  writeFileSync(path.join(product, nonCanonicalMigrationRelative), nonCanonicalMigration, "utf8")
  if (freshManifest.managedFiles?.[productMigrationRelative]) throw new Error("Fresh flat Product migration was incorrectly recorded as Core-managed.")
  if (freshManifest.managedFiles?.[nonCanonicalMigrationRelative]) throw new Error("Fresh noncanonical nested migration was incorrectly recorded as Core-managed.")
  run(process.execPath, [packageCli, "doctor", product], root)
  const freshDoctor = JSON.parse(runOutput(process.execPath, [packageCli, "doctor", product, "--json"], root))
  if (freshDoctor.errors !== 0 || !freshDoctor.checks.some((check) => check.category === "PRODUCT" && check.detail.includes("Product-owned migration(s)"))) throw new Error("Fresh doctor did not accept the flat Product migration ownership.")
  if (!freshDoctor.checks.some((check) => check.category === "MIGRATION" && check.status === "WARNING" && check.detail.includes(nonCanonicalMigrationRelative))) throw new Error("Fresh doctor did not report the noncanonical nested migration warning.")
  const freshDiff = JSON.parse(runOutput(process.execPath, [packageCli, "diff", product, "--json"], root))
  if (freshDiff.coreDrift.length || !freshDiff.productMigrationsIgnored.includes(productMigrationRelative)) throw new Error("Fresh diff did not preserve the flat Product migration ownership.")
  if (!freshDiff.nonCanonicalMigrations.includes(nonCanonicalMigrationRelative)) throw new Error("Fresh diff did not preserve the noncanonical nested migration.")
  const freshDryRun = JSON.parse(runOutput(process.execPath, [packageCli, "update", product, "--dry-run", "--json"], root))
  if (freshDryRun.productMigrationsIgnored.includes(productMigrationRelative) === false || freshDryRun.added.includes(productMigrationRelative) || freshDryRun.removed.includes(productMigrationRelative)) throw new Error("Fresh update dry-run did not preserve the flat Product migration.")
  if (!freshDryRun.nonCanonicalMigrations.includes(nonCanonicalMigrationRelative) || freshDryRun.added.includes(nonCanonicalMigrationRelative) || freshDryRun.updated.includes(nonCanonicalMigrationRelative) || freshDryRun.removed.includes(nonCanonicalMigrationRelative)) throw new Error("Fresh update dry-run did not preserve the noncanonical nested migration.")
  configureDisposableSupabase(product, "fresh", await findDisposablePortBase())
  startDisposableSupabase(product)
  run(supabaseBinary, ["db", "reset", "--local", "--workdir", product], product, { SUPABASE_TELEMETRY_DISABLED: "1" })
  await assertDisposableSchema(product, [productMigrationTable])
  const supabaseEnvironment = localSupabaseEnvironment()
  writeFileSync(path.join(product, ".npmrc"), `registry=https://registry.npmjs.org/\n@sapienx:registry=${registryUrl}\n`, "utf8")
  run("npm", ["install", "--ignore-scripts", "--audit=false", "--fund=false"], product)
  const installedCli = path.join(product, "node_modules/.bin/saas-core")
  if (!existsSync(installedCli)) throw new Error("Packed Core CLI was not installed in the generated consumer.")
  run(installedCli, ["doctor", product], product)
  run("npm", ["run", "db:types"], product, { SUPABASE_TELEMETRY_DISABLED: "1" })
  if (!readFileSync(path.join(product, "types/supabase.ts"), "utf8").includes(`${productMigrationTable}:`)) throw new Error("Generated consumer types do not include the executed flat Product table.")
  stopDisposableSupabase(product)
  run(process.execPath, ["--input-type=module", "-e", packedExportProbe], product)
  run(installedCli, ["init", "Packed CLI Proof", packedProduct], product)
  assertConsumerIgnore(packedProduct)
  for (const relative of agentSurfaceFiles) if (!existsSync(path.join(packedProduct, relative))) throw new Error(`Packed CLI consumer is missing Agent Surface file: ${relative}`)
  for (const relative of billingManagedFiles) if (!existsSync(path.join(packedProduct, relative))) throw new Error(`Packed CLI consumer is missing managed billing file: ${relative}`)
  if (!existsSync(path.join(packedProduct, productUsageExtension))) throw new Error("Packed CLI consumer is missing the product-owned usage resolver extension.")
  run(installedCli, ["doctor", packedProduct], packedProduct)
  const legacyThemeFile = path.join(packedProduct, "styles/product-theme.css")
  const legacyTheme = `${readFileSync(legacyThemeFile, "utf8")}\n:root { --legacy-upgrade-proof: #123456; }\n`
  writeFileSync(legacyThemeFile, legacyTheme, "utf8")
  const consumerGitignoreFile = path.join(packedProduct, ".gitignore")
  const consumerGitignore = `${readFileSync(consumerGitignoreFile, "utf8")}\n# Product-local ignore extension\nproduct-local-cache/\n`
  writeFileSync(consumerGitignoreFile, consumerGitignore, "utf8")
  const legacyProductMigrations = [
    [productMigrationRelative, productMigration, productMigrationTable],
    ["supabase/migrations/20260916000000_product-proof-venues.sql", "create table if not exists public.product_proof_venues (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, name text not null);\nalter table public.product_proof_venues enable row level security;\ngrant all on table public.product_proof_venues to service_role;\n", "product_proof_venues"],
    ["supabase/migrations/20260916000001_product-proof-schedules.sql", "create table if not exists public.product_proof_schedules (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, venue_id uuid not null references public.product_proof_venues(id) on delete cascade, starts_at timestamptz not null);\nalter table public.product_proof_schedules enable row level security;\ngrant all on table public.product_proof_schedules to service_role;\n", "product_proof_schedules"],
    ["supabase/migrations/20260916000002_product-proof-catalog-items.sql", "create table if not exists public.product_proof_catalog_items (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, title text not null);\nalter table public.product_proof_catalog_items enable row level security;\ngrant all on table public.product_proof_catalog_items to service_role;\n", "product_proof_catalog_items"],
  ]
  const legacyMigrationSnapshots = new Map()
  for (const [relative, content] of legacyProductMigrations) {
    mkdirSync(path.dirname(path.join(packedProduct, relative)), { recursive: true })
    writeFileSync(path.join(packedProduct, relative), content, "utf8")
    legacyMigrationSnapshots.set(relative, content)
  }
  downgradeToLegacyConsumer(packedProduct, [...agentSurfaceFiles, ...billingManagedFiles])
  rmSync(path.join(packedProduct, productUsageExtension), { force: true })
  const legacyDiff = JSON.parse(runOutput(installedCli, ["diff", packedProduct, "--json"], packedProduct, {}, 2))
  if (!legacyDiff.versionDrift.includes(`Core version ${LEGACY_VERSION} → ${RELEASE_VERSION}`)) throw new Error("Packed CLI did not report the legacy runtime upgrade.")
  if (legacyDiff.schemaDrift.length || legacyDiff.packageDrift.length !== 4 || legacyDiff.packageDrift.some((item) => item.actual !== `^${LEGACY_VERSION}` || item.expected !== `^${RELEASE_VERSION}`)) throw new Error("Packed CLI did not report the legacy package movement while preserving schema 2.0.")
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) if (!legacyDiff.coreDrift.includes(`A ${relative}`)) throw new Error(`Packed CLI legacy diff omitted managed billing/surface addition ${relative}.`)
  const legacyDryRun = JSON.parse(runOutput(installedCli, ["update", packedProduct, "--dry-run", "--json"], packedProduct))
  if (!legacyDryRun.scaffolded?.includes(productUsageExtension)) throw new Error("Packed CLI did not plan the missing product usage resolver scaffold.")
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) if (!legacyDryRun.added.includes(relative)) throw new Error(`Packed CLI legacy dry-run omitted managed billing/surface addition ${relative}.`)
  if (!legacyDryRun.updated.includes("package.json")) throw new Error("Packed CLI legacy dry-run omitted the package version movement.")
  const legacyApply = JSON.parse(runOutput(installedCli, ["update", packedProduct, "--json"], packedProduct))
  if (JSON.stringify(legacyApply.updated) !== JSON.stringify(legacyDryRun.updated) || JSON.stringify(legacyApply.added) !== JSON.stringify(legacyDryRun.added) || JSON.stringify(legacyApply.removed) !== JSON.stringify(legacyDryRun.removed)) throw new Error("Packed CLI legacy dry-run plan did not match the real update plan.")
  const upgradedLegacyManifest = JSON.parse(readFileSync(path.join(packedProduct, ".saas-core-manifest.json"), "utf8"))
  if (upgradedLegacyManifest.coreVersion !== RELEASE_VERSION || upgradedLegacyManifest.schemaVersion !== SCHEMA_VERSION || Object.values(upgradedLegacyManifest.packageVersions).some((value) => value !== `^${RELEASE_VERSION}`)) throw new Error(`Packed legacy consumer manifest was not upgraded to Core ${RELEASE_VERSION} / schema ${SCHEMA_VERSION}.`)
  const upgradedLegacyPackage = JSON.parse(readFileSync(path.join(packedProduct, "package.json"), "utf8"))
  if (runtimePackages.some((name) => upgradedLegacyPackage.dependencies[name] !== `^${RELEASE_VERSION}`) || toolingPackages.some((name) => upgradedLegacyPackage.devDependencies[name] !== `^${RELEASE_VERSION}`)) throw new Error(`Packed legacy consumer package.json was not upgraded to ^${RELEASE_VERSION}.`)
  if (readFileSync(legacyThemeFile, "utf8") !== legacyTheme) throw new Error("Packed legacy update overwrote the product-owned theme.")
  if (readFileSync(consumerGitignoreFile, "utf8") !== consumerGitignore) throw new Error("Packed consumer update overwrote the product-local .gitignore policy.")
  for (const [relative, content] of legacyMigrationSnapshots) {
    if (readFileSync(path.join(packedProduct, relative), "utf8") !== content) throw new Error(`Packed consumer update changed a product-owned migration: ${relative}`)
    if (upgradedLegacyManifest.managedFiles?.[relative]) throw new Error(`Packed legacy manifest adopted a Product migration: ${relative}`)
  }
  if (!readFileSync(path.join(packedProduct, productUsageExtension), "utf8").includes("PRODUCT_USAGE_RESOLVERS")) throw new Error("Packed legacy update did not restore the neutral product usage resolver scaffold.")
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) if (!existsSync(path.join(packedProduct, relative))) throw new Error(`Packed legacy update did not restore managed file: ${relative}`)
  configureDisposableSupabase(packedProduct, "legacy", await findDisposablePortBase())
  startDisposableSupabase(packedProduct)
  run(supabaseBinary, ["db", "reset", "--local", "--workdir", packedProduct], packedProduct, { SUPABASE_TELEMETRY_DISABLED: "1" })
  await assertDisposableSchema(packedProduct, legacyProductMigrations.map(([, , table]) => table))
  writeFileSync(path.join(packedProduct, ".npmrc"), `registry=https://registry.npmjs.org/\n@sapienx:registry=${registryUrl}\n`, "utf8")
  run("npm", ["install", "--ignore-scripts", "--audit=false", "--fund=false"], packedProduct)
  const legacyInstalledCli = path.join(packedProduct, "node_modules/.bin/saas-core")
  run(legacyInstalledCli, ["doctor", packedProduct], packedProduct)
  run(process.execPath, ["--input-type=module", "-e", packedExportProbe], packedProduct)
  run("npm", ["run", "db:types"], packedProduct, { SUPABASE_TELEMETRY_DISABLED: "1" })
  const legacyTypes = readFileSync(path.join(packedProduct, "types/supabase.ts"), "utf8")
  for (const [, , table] of legacyProductMigrations) if (!legacyTypes.includes(`${table}:`)) throw new Error(`Legacy consumer generated types do not include ${table}.`)
  stopDisposableSupabase(packedProduct)
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
  for (const migration of billingMigrations) if (!existsSync(path.join(relocated, migration))) throw new Error(`Relocation or frozen install lost ${migration}.`)
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
  console.log(JSON.stringify({ status: "PASS", product: relocated, install: "packed Core through local registry", packedExports: true, packedBillingContract: true, freshConsumer: `${RELEASE_VERSION} / schema ${SCHEMA_VERSION}`, legacyConsumerUpgrade: `${LEGACY_VERSION} -> ${RELEASE_VERSION}`, billingManagedUpdate: true, legacyProductOwnedPreserved: true, nonCanonicalNestedPreserved: true, consumerIgnorePreserved: true, legacyTypecheck: true, legacyTests: true, legacyBuild: true, configuredShell: true, browserShell: browserShell && relocatedBrowserShell, relocation: true, frozenInstall: true }))
} finally {
  stopDisposableSupabase(product)
  stopDisposableSupabase(packedProduct)
  registryProcess.kill("SIGTERM")
  rmSync(product, { recursive: true, force: true })
  rmSync(packedProduct, { recursive: true, force: true })
  rmSync(relocatedParent, { recursive: true, force: true })
  rmSync(npmCache, { recursive: true, force: true })
}
