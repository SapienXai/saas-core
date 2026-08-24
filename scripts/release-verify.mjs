import { execFileSync, spawn } from "node:child_process"
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
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
  const app = join(appDirectory, "app")
  run("node", ["packages/core/dist/cli.js", "init", app, "--yes", "--non-interactive"], { env: { ...env, SAAS_CORE_TARBALL_DIR: join(root, "artifacts") } })
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
  run("pnpm", ["--dir", app, "install", "--no-frozen-lockfile"])
  run("pnpm", ["--dir", app, "saas-core", "doctor"])
  run("pnpm", ["--dir", app, "saas-core", "diff"])
  run("pnpm", ["--dir", app, "saas-core", "test"])
  run("pnpm", ["--dir", app, "typecheck"])
  run("pnpm", ["--dir", app, "build"])
  const next = start("pnpm", ["--dir", app, "exec", "next", "dev", "--port", "4322"], { env: { ...env, APP_URL: "http://127.0.0.1:4322", SAAS_CORE_PRODUCT_NAME: "Release Verify" } })
  await waitFor("http://127.0.0.1:4322/", next)
  run("pnpm", ["--dir", app, "exec", "playwright", "install", ...(process.env.CI ? ["--with-deps"] : []), "chromium"])
  run("node", ["generated-app.e2e.mjs"], { cwd: app, env: { ...env, SAAS_CORE_APP_URL: "http://127.0.0.1:4322" } })
  console.log("\n[release:verify] full local release verification passed")
} finally {
  for (const child of children.reverse()) if (child.exitCode === null) child.kill("SIGTERM")
  for (const directory of created) rmSync(directory, { recursive: true, force: true })
  if (startedSupabase) {
    try { run("supabase", ["stop", "--no-backup"]) } catch (error) { console.error(`[release:verify] could not stop the SaaS Core stack: ${error.message}`) }
  }
}
