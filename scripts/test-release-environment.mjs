import { spawnSync } from "node:child_process"

const poisonedEnvironment = {
  ...process.env,
  SUPABASE_URL: "https://ci.invalid.supabase.co",
  SUPABASE_ANON_KEY: "ci-placeholder-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "ci-placeholder-service-role-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://ci.invalid.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "ci-placeholder-anon-key",
  SAAS_CORE_ROOT_DOMAIN: "core.invalid",
  SAAS_CORE_APP_DOMAIN: "app.core.invalid",
  SAAS_CORE_APP_URL: "https://app.core.invalid",
  NEXT_PUBLIC_SITE_URL: "https://core.invalid",
  NEXT_PUBLIC_APP_URL: "https://app.core.invalid",
}

const result = spawnSync(process.execPath, ["scripts/run-release-unit-tests.mjs", "test/domains.test.ts"], {
  encoding: "utf8",
  env: poisonedEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
})
const output = `${result.stdout || ""}\n${result.stderr || ""}`

if (result.error) throw result.error
if (result.status !== 0) {
  process.stdout.write(output)
  throw new Error(`Release unit tests were not isolated from the poisoned parent environment (exit ${result.status ?? 1}).`)
}
if (output.includes("ci.invalid.supabase.co")) throw new Error("Release unit-test output exposed or contacted the poisoned Supabase endpoint.")
console.log(JSON.stringify({ status: "PASS", parentEnvironment: "poisoned", childEnvironment: "sanitized", externalSupabase: "not-contacted", canonicalDomains: "preserved" }))
