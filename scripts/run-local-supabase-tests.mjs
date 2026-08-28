import { execFileSync, spawnSync } from "node:child_process"

const shouldReset = process.argv.includes("--reset")
const statusEnvironment = { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }

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

const environment = {
  ...process.env,
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET: status.JWT_SECRET,
}

const result = spawnSync("./node_modules/.bin/vitest", ["run", "--no-file-parallelism", "test/core-rls.integration.test.ts", "test/default-plan.integration.test.ts", "test/public-workspace.integration.test.ts"], {
  stdio: "inherit",
  env: environment,
})
process.exit(result.status ?? 1)
