import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { execFileSync, spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const root = process.cwd()
const script = path.join(root, "scripts/billing-sync-catalog.mjs")
const fixture = await mkdtemp(path.join(os.tmpdir(), "saas-core-catalog-"))
const missingDefault = path.join(fixture, "missing-default.json")
const missingWorkspaceLimit = path.join(fixture, "missing-workspace-limit.json")
const inactiveDefault = path.join(fixture, "inactive-default.json")
const validCatalog = path.join(fixture, "valid.json")
const switchedCatalog = path.join(fixture, "switched.json")

function status() {
  return JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], { cwd: root, encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } }))
}

function run(catalogPath, ...args) {
  const local = status()
  return spawnSync(process.execPath, [script, catalogPath, ...args], {
    cwd: root,
    env: { ...process.env, SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY },
    encoding: "utf8",
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const plans = [
  { key: "scale", name: "Scale", sort_order: 0, features: {}, limits: { "core.workspaces": 3 }, metadata: { fixture: true } },
  { key: "hobby", name: "Hobby", sort_order: 99, features: {}, limits: { "core.workspaces": 3 }, metadata: { fixture: true } },
]

try {
  await writeFile(missingDefault, JSON.stringify({ plans, usageMetrics: [] }, null, 2))
  await writeFile(missingWorkspaceLimit, JSON.stringify({ defaultPlanKey: "hobby", plans: plans.map((plan) => plan.key === "hobby" ? { ...plan, limits: {} } : plan), usageMetrics: [] }, null, 2))
  await writeFile(inactiveDefault, JSON.stringify({ defaultPlanKey: "hobby", plans: plans.map((plan) => plan.key === "hobby" ? { ...plan, active: false } : plan), usageMetrics: [] }, null, 2))
  await writeFile(validCatalog, JSON.stringify({ defaultPlanKey: "hobby", plans, usageMetrics: [{ key: "projects", name: "Projects" }] }, null, 2))
  await writeFile(switchedCatalog, JSON.stringify({ defaultPlanKey: "scale", plans, usageMetrics: [{ key: "projects", name: "Projects" }] }, null, 2))

  let result = run(missingDefault)
  assert(result.status !== 0 && result.stderr.includes("defaultPlanKey"), "catalog sync accepted a missing defaultPlanKey")
  result = run(missingWorkspaceLimit)
  assert(result.status !== 0 && result.stderr.includes("core.workspaces"), "catalog sync accepted a default plan without an explicit workspace limit")
  result = run(inactiveDefault)
  assert(result.status !== 0 && result.stderr.includes("active"), "catalog sync accepted an inactive default plan")
  result = run(validCatalog)
  assert(result.status === 0, result.stderr || "valid catalog sync failed")
  const synced = JSON.parse(result.stdout)
  assert(synced.defaultPlanKey === "hobby" && synced.synchronized === 2, "catalog sync did not persist/report the configured default")
  result = run(validCatalog)
  assert(result.status === 0 && JSON.parse(result.stdout).defaultPlanKey === "hobby", "catalog sync was not safe to rerun idempotently")
  result = run(switchedCatalog, "--dry-run")
  assert(result.status === 0, result.stderr || "catalog dry-run failed")
  const dryRun = JSON.parse(result.stdout)
  assert(dryRun.dryRun === true && dryRun.defaultPlanKey === "scale" && dryRun.synchronized === 0, "catalog dry-run mutated or misreported the plan sync")
  result = run(switchedCatalog)
  assert(result.status === 0, result.stderr || "catalog default switch failed")
  assert(JSON.parse(result.stdout).defaultPlanKey === "scale", "catalog default switch was not acknowledged")
  console.log(JSON.stringify({ status: "PASS", missingDefaultRejected: true, missingWorkspaceLimitRejected: true, inactiveDefaultRejected: true, arbitrarySortOrder: true, syncIdempotentContract: true, dryRun: true, defaultSwitch: true }))
} finally {
  const restore = path.join(root, "product.catalog.json")
  const local = (() => { try { return status() } catch { return null } })()
  if (local?.API_URL && local.SERVICE_ROLE_KEY) spawnSync(process.execPath, [script, restore], { cwd: root, env: { ...process.env, SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY }, stdio: "ignore" })
  await rm(fixture, { recursive: true, force: true })
}
