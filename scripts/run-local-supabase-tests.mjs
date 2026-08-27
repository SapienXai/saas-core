import { execFileSync, spawnSync } from "node:child_process"

const shouldReset = process.argv.includes("--reset")
const statusEnvironment = { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }

if (shouldReset) {
  const reset = spawnSync("pnpm", ["run", "db:reset"], { stdio: "inherit", env: statusEnvironment })
  if (reset.status !== 0) process.exit(reset.status ?? 1)
}

const rawStatus = execFileSync(
  "supabase",
  ["status", "--workdir", ".", "-o", "json"],
  { encoding: "utf8", env: statusEnvironment },
)
const status = JSON.parse(rawStatus)

if (!/^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(status.API_URL ?? "")) {
  throw new Error("Refusing integration tests: local Reservevia Supabase is not running on port 54521.")
}

const environment = {
  ...process.env,
  NODE_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  PADDLE_ENVIRONMENT: "sandbox",
  RESERVEVIA_SCENARIOS_ENABLED: "1",
}

const result = spawnSync(
  "pnpm",
  ["run", "test:run", "--", "test/supabase-rls.integration.test.ts", "test/self-service.integration.test.ts", "test/team-multi-restaurant.integration.test.ts", "test/claimable.integration.test.ts", "test/reservation-lifecycle.integration.test.ts", "test/dataengine.integration.test.ts"],
  { stdio: "inherit", env: environment },
)

process.exit(result.status ?? 1)
