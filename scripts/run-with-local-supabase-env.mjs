import { execFileSync, spawnSync } from "node:child_process"

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error("Usage: node scripts/run-with-local-supabase-env.mjs <command> [args…]")

const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], {
  encoding: "utf8",
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
}))
if (!/^https?:\/\/(127\.0\.0\.1|localhost):55521$/.test(status.API_URL ?? "")) {
  throw new Error("Refusing to inject environment: the isolated local SaaS Core Supabase project is not running on port 55521.")
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

const result = spawnSync(command, args.filter((argument) => argument !== "--"), { stdio: "inherit", env: environment })
process.exit(result.status ?? 1)
