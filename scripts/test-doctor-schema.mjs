import { mkdtemp, rm } from "node:fs/promises"
import { execFileSync, spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const root = process.cwd()
const cli = path.join(root, "packages/cli/bin/saas-core.mjs")
const fixture = await mkdtemp(path.join(os.tmpdir(), "saas-core-doctor-schema-"))
const product = path.join(fixture, "product")

function runDoctor(environment) {
  return spawnSync(process.execPath, [cli, "doctor", product, "--json"], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function withoutDatabaseCredentials() {
  const environment = { ...process.env, SAAS_CORE_TEMPLATE: path.join(root, "packages/app/template") }
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"]) delete environment[key]
  return environment
}

function localSupabaseStatus() {
  try {
    return JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], { cwd: root, encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } }))
  } catch {
    return null
  }
}

function localDbContainer() {
  try {
    const names = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
    return names.find((name) => /saas[-_]core/i.test(name) && /db/i.test(name)) || names.find((name) => /supabase.*db/i.test(name)) || null
  } catch {
    return null
  }
}

function mutateMetadata(container, sql) {
  execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "inherit" })
}

try {
  const init = spawnSync(process.execPath, [cli, "init", "Doctor Schema", product], { cwd: root, env: withoutDatabaseCredentials(), encoding: "utf8" })
  assert(init.status === 0, init.stderr || "doctor schema fixture init failed")

  const withoutCredentials = runDoctor(withoutDatabaseCredentials())
  assert(withoutCredentials.status === 0, withoutCredentials.stderr || "doctor should warn, not fail, without database credentials")
  const warningReport = JSON.parse(withoutCredentials.stdout)
  assert(warningReport.checks.some((check) => check.category === "DATABASE" && check.status === "WARNING"), "doctor did not report the missing database credentials as a warning")

  const status = localSupabaseStatus()
  if (!status?.API_URL || !status.SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({ status: "PASS", credentialsWarning: true, liveDatabase: "SKIPPED_LOCAL_SUPABASE_NOT_RUNNING" }))
  } else {
    const liveEnvironment = { ...withoutDatabaseCredentials(), SUPABASE_URL: status.API_URL, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY }
    const healthy = runDoctor(liveEnvironment)
    assert(healthy.status === 0, healthy.stderr || healthy.stdout || "doctor rejected matching Core schema metadata")
    const healthyReport = JSON.parse(healthy.stdout)
    assert(healthyReport.checks.some((check) => check.category === "DATABASE" && check.status === "INFO" && check.detail.includes("verified")), "doctor did not verify the live Core schema")

    const container = localDbContainer()
    assert(container, "Local Supabase is running but its database container could not be identified for schema metadata tests.")
    mutateMetadata(container, "update private.core_schema_metadata set schema_version = '1.0', runtime_major = 1 where singleton;")
    const mismatch = runDoctor(liveEnvironment)
    assert(mismatch.status !== 0, "doctor accepted an incompatible database schema")
    assert(JSON.parse(mismatch.stdout).checks.some((check) => check.category === "DATABASE" && check.status === "ERROR" && check.detail.includes("incompatible")), "doctor did not report the schema mismatch")

    mutateMetadata(container, "update private.core_schema_metadata set schema_version = '2.0', runtime_major = 2 where singleton;")
    mutateMetadata(container, "delete from private.core_schema_metadata where singleton;")
    const missing = runDoctor(liveEnvironment)
    assert(missing.status !== 0, "doctor accepted missing schema metadata")
    assert(JSON.parse(missing.stdout).checks.some((check) => check.category === "DATABASE" && check.status === "ERROR"), "doctor did not report missing schema metadata")
    mutateMetadata(container, "insert into private.core_schema_metadata (singleton, schema_version, runtime_major) values (true, '2.0', 2) on conflict (singleton) do update set schema_version = excluded.schema_version, runtime_major = excluded.runtime_major, updated_at = now();")

    console.log(JSON.stringify({ status: "PASS", credentialsWarning: true, matchingSchema: true, mismatchRejected: true, missingMetadataRejected: true }))
  }
} finally {
  await rm(fixture, { recursive: true, force: true })
}
