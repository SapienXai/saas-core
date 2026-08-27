import { execFileSync, spawnSync } from "node:child_process"

const statusEnvironment = { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
const rawStatus = execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], {
  encoding: "utf8",
  env: statusEnvironment,
})
const status = JSON.parse(rawStatus)

if (!/^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(status.API_URL ?? "")) {
  throw new Error("Refusing browser E2E: local Reservevia Supabase is not running on port 54521.")
}

const environment = {
  ...process.env,
  NODE_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET: status.JWT_SECRET,
  RESERVEVIA_MAIL_URL: status.MAILPIT_URL || status.INBUCKET_URL || "http://127.0.0.1:54524",
  PADDLE_ENVIRONMENT: "sandbox",
  RESEND_API_KEY: "",
  MANAGEMENT_EMAIL: "ops@reservevia.test",
  RESERVEVIA_SCENARIOS_ENABLED: "1",
  RESERVEVIA_E2E: "1",
}

const appUrl = new URL(environment.RESERVEVIA_APP_URL || "http://127.0.0.1:3100")
environment.RESERVEVIA_APP_URL = appUrl.toString().replace(/\/$/, "")
environment.PORT = appUrl.port || "3100"

const result = spawnSync("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: environment,
})

process.exit(result.status ?? 1)
