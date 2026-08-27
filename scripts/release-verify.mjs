import { execFileSync, spawn } from "node:child_process"
import { copyFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"

const root = resolve(new URL("..", import.meta.url).pathname)
const env = { ...process.env }
const created = []
const children = []

function run(command, args, options = {}) {
  console.log(`\n[release:verify] ${command} ${args.join(" ")}`)
  execFileSync(command, args, { cwd: root, stdio: "inherit", env, ...options })
}

function shellEnv(output) {
  const result = {}
  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    const match = output.match(new RegExp(`^${key}=["']?([^"'\\n]+)["']?$`, "m"))
    if (match?.[1]) result[key] = match[1]
  }
  if (!result.API_URL || !result.ANON_KEY || !result.SERVICE_ROLE_KEY) throw new Error("Supabase status did not return API_URL, ANON_KEY and SERVICE_ROLE_KEY.")
  return result
}

function supabaseEnv() {
  try {
    return shellEnv(execFileSync("supabase", ["status", "-o", "env"], { cwd: root, encoding: "utf8", env }))
  } catch {
    return null
  }
}

async function waitFor(url, child, timeoutMs = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await globalThis.fetch(url)
      if (response.ok) return
    } catch {
      // The child is still starting.
    }
    if (child.exitCode !== null) throw new Error(`Process exited before ${url} became available.`)
    await new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, 1000))
  }
  throw new Error(`Timed out waiting for ${url}.`)
}

function start(command, args, options) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit", ...options })
  children.push(child)
  return child
}

let startedSupabase = false
let supabase
let appDirectory
let artifactDirectory
let registry
let relocatedApp

function assertPortableProduct(directory, forbiddenPath) {
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory() && [".next", "node_modules"].includes(entry.name)) continue
      if (entry.isDirectory()) visit(path)
      else files.push(path)
    }
  }
  visit(directory)
  const absoluteFileReference = /file:(?:\/|[A-Za-z]:[\\/])/i
  for (const path of files) {
    const content = readFileSync(path, "utf8")
    if (content.includes(forbiddenPath) || absoluteFileReference.test(content)) throw new Error(`Generated product contains a machine-specific path: ${relative(directory, path)}`)
  }
}

function preparePackageInstall(directory, registryUrl) {
  const npmrc = join(directory, ".npmrc")
  writeFileSync(npmrc, `@sapienx:registry=${registryUrl}\n`)
  return npmrc
}

async function startRegistry(artifactDirectory, outputPath) {
  const child = spawn(process.execPath, [join(root, "scripts/local-package-registry.mjs"), artifactDirectory, outputPath], { cwd: root, env, stdio: "inherit" })
  children.push(child)
  const started = Date.now()
  while (!readFileIfPresent(outputPath)) {
    if (child.exitCode !== null) throw new Error("Local package registry exited before it became available.")
    if (Date.now() - started > 30000) throw new Error("Timed out waiting for the local package registry.")
    await new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, 100))
  }
  return { url: readFileSync(outputPath, "utf8").trim(), close: () => new Promise((resolvePromise) => { if (child.exitCode !== null) resolvePromise(); else { child.once("exit", resolvePromise); child.kill("SIGTERM"); globalThis.setTimeout(() => child.kill("SIGKILL"), 1000) } }) }
}

function readFileIfPresent(path) {
  try { return readFileSync(path, "utf8") } catch { return null }
}

try {
  run("pnpm", ["release:check"])
  supabase = supabaseEnv()
  if (!supabase) {
    run("supabase", ["start"])
    startedSupabase = true
    supabase = supabaseEnv()
  }
  run("supabase", ["db", "reset", "--yes"])
  env.SUPABASE_URL = supabase.API_URL
  env.SUPABASE_ANON_KEY = supabase.ANON_KEY
  env.NEXT_PUBLIC_SUPABASE_URL = supabase.API_URL
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabase.ANON_KEY
  env.SUPABASE_SERVICE_ROLE_KEY = supabase.SERVICE_ROLE_KEY
  run("pnpm", ["exec", "vitest", "run", "tests/database.integration.test.ts"], { env: { ...env, SAAS_CORE_DB_INTEGRATION: "1" } })

  const lab = start(process.execPath, ["apps/core-lab/server.mjs"], { env: { ...env, CORE_LAB_PORT: "4174" } })
  await waitFor("http://127.0.0.1:4174/api/scenarios", lab)
  const labPayload = await (await globalThis.fetch("http://127.0.0.1:4174/api/scenarios")).json()
  if (labPayload.scenarios.some((scenario) => scenario.status === "FAIL") || labPayload.scenarios.some((scenario) => !scenario.operation || !scenario.actual)) throw new Error("Core Lab returned a failed or non-executed scenario.")
  console.log(`[release:verify] Core Lab ${labPayload.scenarios.length} executable scenarios verified`)

  appDirectory = mkdtempSync(join(tmpdir(), "saas-core-release-verify-"))
  created.push(appDirectory)
  artifactDirectory = mkdtempSync(join(tmpdir(), "saas-core-release-artifacts-"))
  created.push(artifactDirectory)
  cpSync(join(root, "artifacts"), join(artifactDirectory, "artifacts"), { recursive: true })
  registry = await startRegistry(join(artifactDirectory, "artifacts"), join(appDirectory, "registry-url"))
  const app = join(appDirectory, "app")
  run("node", ["packages/core/dist/cli.js", "init", app, "--yes", "--non-interactive"], { env: { ...env, SAAS_CORE_TARBALL_DIR: join(artifactDirectory, "artifacts") } })
  assertPortableProduct(app, join(artifactDirectory, "artifacts"))
  writeFileSync(join(app, ".env.local"), [
    "APP_URL=http://127.0.0.1:4322",
    "SAAS_CORE_PRODUCT_NAME=Release Verify",
    `NEXT_PUBLIC_SUPABASE_URL=${supabase.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${supabase.ANON_KEY}`,
    `SUPABASE_URL=${supabase.API_URL}`,
    `SUPABASE_ANON_KEY=${supabase.ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${supabase.SERVICE_ROLE_KEY}`,
    "PADDLE_ENVIRONMENT=sandbox",
    "",
  ].join("\n"))
  copyFileSync(join(root, "tests/generated-app.e2e.mjs"), join(app, "generated-app.e2e.mjs"))
  let npmrc = preparePackageInstall(app, registry.url)
  run("pnpm", ["--dir", app, "install", "--no-frozen-lockfile"])
  assertPortableProduct(app, join(artifactDirectory, "artifacts"))
  rmSync(npmrc)
  run("pnpm", ["--dir", app, "saas-core", "doctor"])
  run("pnpm", ["--dir", app, "saas-core", "diff"])
  run("pnpm", ["--dir", app, "saas-core", "test"])
  run("pnpm", ["--dir", app, "typecheck"])
  run("pnpm", ["--dir", app, "build"])
  const next = start("pnpm", ["--dir", app, "exec", "next", "dev", "--port", "4322"], { env: { ...env, APP_URL: "http://127.0.0.1:4322", SAAS_CORE_PRODUCT_NAME: "Release Verify" } })
  await waitFor("http://127.0.0.1:4322/", next)
  run("pnpm", ["--dir", app, "exec", "playwright", "install", ...(process.env.CI ? ["--with-deps"] : []), "chromium"])
  run("node", ["generated-app.e2e.mjs"], { cwd: app, env: { ...env, SAAS_CORE_APP_URL: "http://127.0.0.1:4322" } })
  relocatedApp = join(appDirectory, "relocated-app")
  cpSync(app, relocatedApp, { recursive: true, filter: (path) => !path.includes(`${sep}node_modules`) && !path.includes(`${sep}.next`) && basename(path) !== ".env.local" && basename(path) !== ".npmrc" })
  assertPortableProduct(relocatedApp, join(artifactDirectory, "artifacts"))
  npmrc = preparePackageInstall(relocatedApp, registry.url)
  run("pnpm", ["--dir", relocatedApp, "install", "--frozen-lockfile"])
  assertPortableProduct(relocatedApp, join(artifactDirectory, "artifacts"))
  rmSync(npmrc)
  run("pnpm", ["--dir", relocatedApp, "saas-core", "diff"])
  run("pnpm", ["--dir", relocatedApp, "saas-core", "test"])
  run("pnpm", ["--dir", relocatedApp, "typecheck"])
  run("pnpm", ["--dir", relocatedApp, "build"])
  console.log("[release:verify] relocated generated-app frozen install and build passed")
  console.log("\n[release:verify] full local release verification passed")
} finally {
  if (registry) {
    try { await registry.close() } catch (error) { console.error(`[release:verify] could not close local package registry: ${error.message}`) }
  }
  for (const child of children.reverse()) if (child.exitCode === null) child.kill("SIGTERM")
  for (const directory of created) rmSync(directory, { recursive: true, force: true })
  if (startedSupabase) {
    try { run("supabase", ["stop", "--no-backup"]) } catch (error) { console.error(`[release:verify] could not stop the SaaS Core stack: ${error.message}`) }
  }
}
