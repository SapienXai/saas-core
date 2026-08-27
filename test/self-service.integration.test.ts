import { afterEach, describe, expect, it } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const describeLocal = /^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(url) && Boolean(anonKey && serviceRoleKey) ? describe : describe.skip

type Fixture = {
  service: SupabaseClient
  client: SupabaseClient
  userId: string
  workspaceIds: string[]
}

async function createFixture(label: string): Promise<Fixture> {
  const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `reservevia-onboarding-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
  const password = "ReserveviaOnboarding!2026"
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error("Could not create local onboarding user")
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  return { service, client, userId: created.data.user.id, workspaceIds: [] }
}

async function bootstrap(fixture: Fixture, name: string, slug: string) {
  const result = await fixture.client.rpc("bootstrap_initial_workspace", {
    target_restaurant_name: name,
    target_workspace_name: name,
    target_restaurant_slug: slug,
  })
  if (result.error || !result.data?.[0]) throw result.error ?? new Error("Could not bootstrap local workspace")
  fixture.workspaceIds.push(result.data[0].workspace_id)
  return result.data[0] as { workspace_id: string; restaurant_id: string; restaurant_slug: string }
}

async function cleanup(fixture: Fixture) {
  for (const workspaceId of fixture.workspaceIds) {
    await fixture.service.from("restaurants").delete().eq("workspace_id", workspaceId)
    await fixture.service.from("workspaces").delete().eq("id", workspaceId)
  }
  await fixture.service.auth.admin.deleteUser(fixture.userId)
}

describeLocal("Reservevia self-service bootstrap", () => {
  const fixtures: Fixture[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map(cleanup))
  })

  it("creates owner, Free subscription, and unpublished first restaurant atomically", async () => {
    const fixture = await createFixture("atomic")
    fixtures.push(fixture)
    const result = await bootstrap(fixture, "Onboarding House", "onboarding-house")
    const [workspace, membership, restaurant, subscription, profile] = await Promise.all([
      fixture.service.from("workspaces").select("id, created_by, onboarding_completed_at").eq("id", result.workspace_id).single(),
      fixture.service.from("workspace_members").select("workspace_id, user_id, role").eq("workspace_id", result.workspace_id).eq("user_id", fixture.userId).single(),
      fixture.service.from("restaurants").select("id, workspace_id, name, slug, status").eq("workspace_id", result.workspace_id).single(),
      fixture.service.from("workspace_subscriptions").select("plan_key, source").eq("workspace_id", result.workspace_id).single(),
      fixture.service.from("admin_profiles").select("id, role, restaurant_id").eq("id", fixture.userId).single(),
    ])
    expect(workspace.data).toMatchObject({ id: result.workspace_id, created_by: fixture.userId, onboarding_completed_at: null })
    expect(membership.data).toMatchObject({ workspace_id: result.workspace_id, user_id: fixture.userId, role: "owner" })
    expect(restaurant.data).toMatchObject({ workspace_id: result.workspace_id, name: "Onboarding House", slug: "onboarding-house", status: "unpublished" })
    expect(subscription.data).toEqual({ plan_key: "free", source: "free" })
    expect(profile.data).toMatchObject({ id: fixture.userId, role: "admin", restaurant_id: restaurant.data?.id })
  })

  it("uses an active subscription override when enforcing restaurant limits", async () => {
    const fixture = await createFixture("override")
    fixtures.push(fixture)
    const result = await bootstrap(fixture, "Override House", "override-house")
    const override = await fixture.service.from("subscription_overrides").insert({ workspace_id: result.workspace_id, plan_key: "business", effective_from: new Date(Date.now() - 60_000).toISOString(), effective_until: new Date(Date.now() + 60_000).toISOString(), reason: "integration test", created_by: fixture.userId }).select("id").single()
    expect(override.error).toBeNull()
    const secondRestaurant = await fixture.service.from("restaurants").insert({ workspace_id: result.workspace_id, name: "Override House Two", slug: "override-house-two", status: "unpublished" }).select("id").single()
    expect(secondRestaurant.error).toBeNull()
    if (override.data?.id) await fixture.service.from("subscription_overrides").delete().eq("id", override.data.id)
  })

  it("is retry-safe but rejects a second self-created workspace attempt", async () => {
    const fixture = await createFixture("retry")
    fixtures.push(fixture)
    const first = await bootstrap(fixture, "Retry House", "retry-house")
    const retry = await fixture.client.rpc("bootstrap_initial_workspace", { target_restaurant_name: "Retry House", target_workspace_name: "Retry House", target_restaurant_slug: "retry-house" })
    expect(retry.error).toBeNull()
    expect(retry.data?.[0]?.workspace_id).toBe(first.workspace_id)
    const second = await fixture.client.rpc("bootstrap_initial_workspace", { target_restaurant_name: "Another Restaurant", target_workspace_name: "Another Restaurant", target_restaurant_slug: "another-restaurant" })
    expect(second.data).toBeNull()
    expect(second.error?.message).toContain("SELF_SERVICE_WORKSPACE_EXISTS")
    const { count } = await fixture.service.from("workspaces").select("id", { count: "exact", head: true }).eq("created_by", fixture.userId)
    expect(count).toBe(1)
  })

  it("allows the same restaurant display name in another workspace", async () => {
    const first = await createFixture("duplicate-first")
    const second = await createFixture("duplicate-second")
    fixtures.push(first, second)
    await bootstrap(first, "Duplicate House", "duplicate-house")
    const result = await bootstrap(second, "Duplicate House", "duplicate-house")
    const restaurant = await second.service.from("restaurants").select("name, slug, workspace_id").eq("workspace_id", result.workspace_id).single()
    expect(restaurant.error).toBeNull()
    expect(restaurant.data).toMatchObject({ name: "Duplicate House", workspace_id: result.workspace_id })
    expect(restaurant.data?.slug).toBe("duplicate-house-2")
  })

  it("does not expose the bootstrap RPC to unauthenticated callers", async () => {
    const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const result = await anonymous.rpc("bootstrap_initial_workspace", { target_restaurant_name: "Unauthenticated House", target_workspace_name: null, target_restaurant_slug: "unauthenticated-house" })
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
  })
})
