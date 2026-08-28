import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { chromium } from "@playwright/test"

const root = process.cwd()
const packageCli = path.join(root, "packages/cli/bin/saas-core.mjs")
const artifacts = path.join(root, "artifacts")
const npmCache = mkdtempSync(path.join(os.tmpdir(), "saas-core-npm-cache-"))
const product = mkdtempSync(path.join(os.tmpdir(), "saas-core-product-"))
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
    if (configured && supabaseEnvironment) await configuredShellBrowserProof(port, supabaseEnvironment)
    else if (configured) console.warn("Configured-shell browser proof skipped: the isolated local Supabase project is not running.")
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
  if (generatedPackage.devDependencies["@sapienx/saas-core-cli"] !== "^2.0.0") throw new Error("Core CLI was not emitted as a tooling dependency.")
  for (const name of ["@sapienx/saas-core", "@sapienx/saas-core-config", "@sapienx/saas-core-ui"]) if (!generatedPackage.dependencies[name]) throw new Error(`Missing runtime Core dependency: ${name}`)
  run(process.execPath, [packageCli, "doctor", product], root)
  const supabaseEnvironment = localSupabaseEnvironment()
  writeFileSync(path.join(product, ".npmrc"), `registry=https://registry.npmjs.org/\n@sapienx:registry=${registryUrl}\n`, "utf8")
  run("npm", ["install", "--ignore-scripts", "--audit=false", "--fund=false"], product)
  const installedCli = path.join(product, "node_modules/.bin/saas-core")
  if (!existsSync(installedCli)) throw new Error("Packed Core CLI was not installed in the generated consumer.")
  run(installedCli, ["doctor", product], product)
  run("npm", ["test"], product)
  run("npm", ["run", "build"], product, supabaseEnvironment || {})
  await bootAndSmoke(product, 3217, true, supabaseEnvironment)
  renameSync(product, relocated)

  const relocatedCli = path.join(relocated, "node_modules/.bin/saas-core")
  run(relocatedCli, ["diff", relocated], relocated)
  run(relocatedCli, ["update", relocated, "--dry-run"], relocated)
  rmSync(path.join(relocated, "node_modules"), { recursive: true, force: true })
  run("npm", ["ci", "--ignore-scripts", "--audit=false", "--fund=false"], relocated)
  if (!existsSync(relocatedCli)) throw new Error("Packed Core CLI was not restored by frozen install.")
  run(relocatedCli, ["doctor", relocated], relocated)
  run("npm", ["test"], relocated)
  run("npm", ["run", "build"], relocated, supabaseEnvironment || {})
  await bootAndSmoke(relocated, 3218, true, supabaseEnvironment)
  run(relocatedCli, ["update", relocated], relocated)
  run(relocatedCli, ["doctor", relocated], relocated)
  const packageJson = JSON.parse(readFileSync(path.join(relocated, "package.json"), "utf8"))
  const persistedPackage = JSON.stringify(packageJson)
  if (/file:|link:|workspace:|registry\.url|\/Users\/|\/private\//.test(persistedPackage) || persistedPackage.includes(root)) throw new Error("Generated consumer contains a local dependency path.")
  console.log(JSON.stringify({ status: "PASS", product: relocated, install: "packed Core through local registry", configuredShell: true, browserShell: Boolean(supabaseEnvironment), relocation: true, frozenInstall: true }))
} finally {
  registryProcess.kill("SIGTERM")
  rmSync(product, { recursive: true, force: true })
  rmSync(relocatedParent, { recursive: true, force: true })
  rmSync(npmCache, { recursive: true, force: true })
}
