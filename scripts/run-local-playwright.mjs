import { execFileSync, spawnSync } from "node:child_process"

const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], {
  encoding: "utf8",
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
}))
if (!/^https?:\/\/(127\.0\.0\.1|localhost):55521$/.test(status.API_URL || "")) {
  throw new Error("Refusing browser E2E: the isolated local SaaS Core Supabase project is not running on port 55521.")
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
  SAAS_CORE_MAIL_URL: status.INBUCKET_URL || "http://127.0.0.1:55524",
  SAAS_CORE_E2E: "1",
  SAAS_CORE_APP_URL: process.env.SAAS_CORE_APP_URL || "http://127.0.0.1:3100",
}

const result = spawnSync("./node_modules/.bin/playwright", ["test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: environment,
})
process.exit(result.status ?? 1)
