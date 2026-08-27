import { execFileSync, spawnSync } from "node:child_process"

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error("Usage: node scripts/run-with-local-supabase-env.mjs <command> [args…]")
const commandArgs = args.filter((argument) => argument !== "--")

const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], { encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } }))
if (!/^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(status.API_URL ?? "")) {
  throw new Error("Refusing to inject environment: local Reservevia Supabase is not running on port 54521.")
}

const environment = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET: status.JWT_SECRET,
}

const result = spawnSync(command, commandArgs, { stdio: "inherit", env: environment })
process.exit(result.status ?? 1)
