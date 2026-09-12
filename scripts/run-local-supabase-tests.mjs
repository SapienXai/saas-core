import { execFileSync, spawnSync } from "node:child_process"
import { createLocalSupabaseEnvironment, createReleaseUnitEnvironment } from "./release-environment.mjs"

const shouldReset = process.argv.includes("--reset")
const statusEnvironment = { ...createReleaseUnitEnvironment(process.env), SUPABASE_TELEMETRY_DISABLED: "1" }

if (shouldReset) {
  const reset = spawnSync("supabase", ["db", "reset", "--local", "--workdir", "."], { stdio: "inherit", env: statusEnvironment })
  if (reset.status !== 0) process.exit(reset.status ?? 1)
}

const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], {
  encoding: "utf8",
  env: statusEnvironment,
}))
if (!/^https?:\/\/(127\.0\.0\.1|localhost):55621$/.test(status.API_URL ?? "")) {
  throw new Error("Refusing integration tests: the isolated local SaaS Core Supabase project is not running on port 55621.")
}

const environment = createLocalSupabaseEnvironment(process.env, status)

const result = spawnSync("./node_modules/.bin/vitest", ["run", "--no-file-parallelism", "test/billing-persistence.integration.test.ts", "test/core-rls.integration.test.ts", "test/default-plan.integration.test.ts", "test/entitlement-lock.integration.test.ts", "test/initial-workspace.integration.test.ts", "test/public-workspace.integration.test.ts"], {
  stdio: "inherit",
  env: environment,
})
process.exit(result.status ?? 1)
