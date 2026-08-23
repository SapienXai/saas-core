import type { CoreSupabaseClient } from "./supabase.js"

export type HealthState = "operational" | "warning" | "error" | "not_configured" | "unknown"
export type HealthCheck = { key: string; label: string; status: HealthState; detail: string; durationMs: number }

async function check(key: string, label: string, fn: () => Promise<string>): Promise<HealthCheck> {
  const started = Date.now()
  try { return { key, label, status: "operational", detail: await fn(), durationMs: Date.now() - started } }
  catch (error) { return { key, label, status: "error", detail: error instanceof Error ? error.message : "Health check failed.", durationMs: Date.now() - started } }
}

export async function inspectSupabaseHealth(client: CoreSupabaseClient, expectedSchemaVersion = "1"): Promise<HealthCheck[]> {
  const checks = await Promise.all([
    check("supabase", "Supabase database", async () => {
      const result = await client.from("saas_core_schema_versions").select("version").eq("version", expectedSchemaVersion).maybeSingle()
      if (result.error) throw new Error(result.error.message)
      if (!result.data) throw new Error(`Required schema version ${expectedSchemaVersion} is missing.`)
      return `schema ${expectedSchemaVersion}`
    }),
    check("rls", "Core RLS", async () => {
      const result = await client.rpc("core_health_check")
      if (result.error) throw new Error(result.error.message)
      return "required functions reachable"
    }),
  ])
  return checks
}

export async function inspectRuntimeHealth(input: {
  client?: CoreSupabaseClient | null
  environment: Record<string, string | undefined>
}): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = []
  const required: Array<[string, string]> = [["SUPABASE_URL", "Supabase URL"], ["SUPABASE_ANON_KEY", "Supabase anon key"], ["SUPABASE_SERVICE_ROLE_KEY", "Supabase service role key"]]
  for (const [key, label] of required) {
    const configured = Boolean(input.environment[key] ?? input.environment[`NEXT_PUBLIC_${key}`])
    checks.push({ key: key.toLowerCase(), label, status: configured ? "operational" : "not_configured", detail: configured ? "configured (secret value hidden)" : "not configured", durationMs: 0 })
  }
  if (input.client) checks.push(...await inspectSupabaseHealth(input.client))
  else checks.push({ key: "supabase-connectivity", label: "Supabase connectivity", status: "not_configured", detail: "credentials are required for a live check", durationMs: 0 })
  return checks
}
