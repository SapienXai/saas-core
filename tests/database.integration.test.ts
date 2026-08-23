import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const enabled = process.env.SAAS_CORE_DB_INTEGRATION === "1"
const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const emailSuffix = `${Date.now()}@saas-core.test`

type Fixture = { service: SupabaseClient; users: Array<{ id: string; email: string; password: string }>; workspaces: string[]; planKey: string }
let fixture: Fixture | null = null

async function createAuthUser(service: SupabaseClient, email: string) {
  const password = "CoreIntegration-123!"
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (result.error || !result.data.user) throw new Error(result.error?.message ?? "Could not create integration user.")
  return { id: result.data.user.id, email, password }
}

async function signedInUser(user: { email: string; password: string }) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  if (result.error) throw new Error(result.error.message)
  return client
}

describe.skipIf(!enabled)("SaaS Core authenticated Supabase integration", () => {
  beforeAll(async () => {
    if (!serviceRoleKey || !anonKey) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY for DB integration tests.")
    const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const users = await Promise.all([createAuthUser(service, `owner-${emailSuffix}`), createAuthUser(service, `foreign-${emailSuffix}`), createAuthUser(service, `member-${emailSuffix}`)])
    const planKey = `integration-${Date.now()}`
    const plan = await service.from("plans").insert({ key: planKey, name: "Integration Test", active: true, limits: { users: 10, api_calls: 10 }, features: { core: true }, billing: { currency: "USD", monthlyPriceCents: 0 } })
    if (plan.error) throw new Error(plan.error.message)
    fixture = { service, users, workspaces: [], planKey }
  })

  afterAll(async () => {
    if (!fixture) return
    for (const workspaceId of fixture.workspaces) await fixture.service.from("workspaces").delete().eq("id", workspaceId)
    await fixture.service.from("plans").delete().eq("key", fixture.planKey)
    for (const user of fixture.users) await fixture.service.auth.admin.deleteUser(user.id)
  })

  it("enforces authenticated tenant isolation and RPC-only membership writes", async () => {
    if (!fixture) throw new Error("Fixture was not initialized.")
    const [ownerClient, foreignClient] = await Promise.all([signedInUser(fixture.users[0]!), signedInUser(fixture.users[1]!)])
    const created = await ownerClient.rpc("create_workspace", { target_name: "Integration A", target_slug: `integration-a-${Date.now()}`, target_timezone: "UTC" })
    expect(created.error).toBeNull()
    const workspaceId = (Array.isArray(created.data) ? created.data[0] : created.data)?.id as string
    fixture.workspaces.push(workspaceId)
    const foreignRead = await foreignClient.from("workspaces").select("id").eq("id", workspaceId)
    expect(foreignRead.error).toBeNull()
    expect(foreignRead.data).toEqual([])
    const forgedWrite = await foreignClient.from("workspace_members").insert({ workspace_id: workspaceId, user_id: fixture.users[1]!.id, role: "owner" })
    expect(forgedWrite.error).not.toBeNull()
  })

  it("keeps concurrent usage increments below the effective plan limit", async () => {
    if (!fixture) throw new Error("Fixture was not initialized.")
    const ownerClient = await signedInUser(fixture.users[0]!)
    const workspaceId = fixture.workspaces[0]!
    const subscription = await fixture.service.from("workspace_subscriptions").update({ plan_key: fixture.planKey }).eq("workspace_id", workspaceId)
    expect(subscription.error).toBeNull()
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => ownerClient.rpc("consume_usage", { target_workspace: workspaceId, target_metric: "api_calls", increment_by: 1 })))
    const successful = results.filter((result) => result.status === "fulfilled" && !result.value.error).length
    const errors = results.map((result) => result.status === "fulfilled" ? result.value.error?.message ?? null : result.reason instanceof Error ? result.reason.message : "rejected").filter(Boolean)
    const usage = await fixture.service.from("workspace_usage_periods").select("amount").eq("workspace_id", workspaceId).eq("metric", "api_calls").maybeSingle()
    expect(usage.error).toBeNull()
    expect(usage.data?.amount ?? 0).toBeLessThanOrEqual(10)
    expect(successful, errors.join(" | ")).toBe(10)
  })
})

if (!enabled) console.info("[database.integration] skipped: set SAAS_CORE_DB_INTEGRATION=1 after supabase db reset")
