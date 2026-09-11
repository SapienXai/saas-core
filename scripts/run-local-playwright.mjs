import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createLocalE2EEnvironment, createReleaseToolingEnvironment } from "./release-environment.mjs"

const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], {
  encoding: "utf8",
  env: { ...createReleaseToolingEnvironment(process.env), SUPABASE_TELEMETRY_DISABLED: "1" },
}))
if (!/^https?:\/\/(127\.0\.0\.1|localhost):55621$/.test(status.API_URL || "")) {
  throw new Error("Refusing browser E2E: the isolated local SaaS Core Supabase project is not running on port 55621.")
}

const environment = createLocalE2EEnvironment(process.env, status)

const nextEnvFile = "next-env.d.ts"
const nextEnvBefore = existsSync(nextEnvFile) ? readFileSync(nextEnvFile, "utf8") : null
const result = spawnSync("./node_modules/.bin/playwright", ["test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: environment,
})
if (nextEnvBefore !== null && readFileSync(nextEnvFile, "utf8") !== nextEnvBefore) writeFileSync(nextEnvFile, nextEnvBefore, "utf8")
process.exit(result.status ?? 1)
