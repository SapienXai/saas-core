import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { fetchPublicRestaurantProfileBySlug } from "../lib/services/public/restaurant-service"
import { destroyScenario, seedScenario, type ScenarioManifest } from "../lib/dev/scenario-factory"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const describeLocal = /^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(url) && Boolean(anonKey && serviceRoleKey) ? describe : describe.skip

function periodBounds() {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

function futureReservationDateForTest() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 7)
  return date.toISOString().slice(0, 10)
}

async function insertReservation(service: SupabaseClient, restaurantId: string, suffix: string) {
  return service.from("reservations").insert({
    restaurant_id: restaurantId,
    customer_name: `Lifecycle Guest ${suffix}`,
    customer_phone: `+1555010${suffix.padStart(4, "0")}`,
    customer_email: `lifecycle-${suffix}@example.test`,
    party_size: 2,
    reservation_date: futureReservationDateForTest(),
    reservation_time: "18:00:00",
    status: "pending",
    reservation_type: "meal",
    booking_source: "online",
  }).select("id").single()
}

describeLocal("reservation lifecycle and quota invariants", () => {
  let service!: SupabaseClient
  beforeAll(() => {
    service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  })
  let manifest: ScenarioManifest | null = null

  afterEach(async () => {
    if (manifest) await destroyScenario(manifest)
    manifest = null
  })

  it("allows reservation 100 after usage 99 and rejects reservation 101", async () => {
    manifest = await seedScenario("free-99")
    const first = await insertReservation(service, manifest.primaryRestaurantId!, "100")
    expect(first.error).toBeNull()

    const second = await insertReservation(service, manifest.primaryRestaurantId!, "101")
    expect(second.data).toBeNull()
    expect(second.error?.message).toContain("Monthly reservation limit reached")

    const bounds = periodBounds()
    const usage = await service.from("workspace_usage_periods").select("reservations_created").eq("workspace_id", manifest.primaryWorkspaceId).eq("period_start", bounds.start).eq("period_end", bounds.end).single()
    expect(usage.error).toBeNull()
    expect(usage.data?.reservations_created).toBe(100)
  })

  it("keeps usage consistent when two callers race for the last Free slot", async () => {
    manifest = await seedScenario("free-99")
    const results = await Promise.all([
      insertReservation(service, manifest.primaryRestaurantId!, "race-a"),
      insertReservation(service, manifest.primaryRestaurantId!, "race-b"),
    ])
    expect(results.filter((result) => !result.error)).toHaveLength(1)
    expect(results.filter((result) => result.error)).toHaveLength(1)

    const bounds = periodBounds()
    const usage = await service.from("workspace_usage_periods").select("reservations_created").eq("workspace_id", manifest.primaryWorkspaceId).eq("period_start", bounds.start).eq("period_end", bounds.end).single()
    expect(usage.data?.reservations_created).toBe(100)
  })

  it("falls back to Free entitlements after an expired past-due grace period", async () => {
    manifest = await seedScenario("free-100")
    const subscription = await service.from("workspace_subscriptions").update({
      plan_key: "pro",
      status: "past_due",
      provider_status: "past_due",
      payment_failure_started_at: new Date(Date.now() - 15 * 86400000).toISOString(),
      payment_grace_ends_at: new Date(Date.now() - 86400000).toISOString(),
    }).eq("workspace_id", manifest.primaryWorkspaceId)
    expect(subscription.error).toBeNull()

    const result = await insertReservation(service, manifest.primaryRestaurantId!, "expired-grace")
    expect(result.data).toBeNull()
    expect(result.error?.message).toContain("Monthly reservation limit reached")
  })

  it("applies a plan change immediately to the quota decision", async () => {
    manifest = await seedScenario("free-100")
    const upgrade = await service.from("workspace_subscriptions").update({ plan_key: "pro", status: "active", source: "manual" }).eq("workspace_id", manifest.primaryWorkspaceId)
    expect(upgrade.error).toBeNull()
    const result = await insertReservation(service, manifest.primaryRestaurantId!, "after-upgrade")
    expect(result.error).toBeNull()
  })

  it("keeps public submission idempotency scoped to one restaurant", async () => {
    manifest = await seedScenario("business-multi")
    const submissionId = `rv_duplicate_${manifest.runId.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`
    const firstRestaurantId = manifest.restaurantIds[0]
    const secondRestaurantId = manifest.restaurantIds[1]
    if (!firstRestaurantId || !secondRestaurantId) throw new Error("Scenario did not provide two restaurants.")

    const insert = (restaurantId: string, suffix: string) => service.from("reservations").insert({
      restaurant_id: restaurantId,
      customer_name: `Idempotency Guest ${suffix}`,
      customer_phone: `+1555020${suffix.padStart(4, "0")}`,
      customer_email: `idempotency-${suffix}@example.test`,
      party_size: 2,
      reservation_date: futureReservationDateForTest(),
      reservation_time: "19:00:00",
      status: "pending",
      reservation_type: "meal",
      booking_source: "online",
      public_submission_id: submissionId,
    }).select("id").single()

    const first = await insert(firstRestaurantId, "one")
    const second = await insert(secondRestaurantId, "two")
    const duplicate = await insert(firstRestaurantId, "retry")
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(duplicate.error?.code).toBe("23505")

    const rows = await service.from("reservations").select("id, restaurant_id").eq("public_submission_id", submissionId)
    expect(rows.error).toBeNull()
    expect(rows.data).toHaveLength(2)
  })

  it("removes a suspended workspace from the public profile resolver", async () => {
    manifest = await seedScenario("pro-active")
    const update = await service.from("workspaces").update({ platform_status: "suspended" }).eq("id", manifest.primaryWorkspaceId)
    expect(update.error).toBeNull()
    await expect(fetchPublicRestaurantProfileBySlug(manifest.primaryRestaurantSlug!)).resolves.toBeNull()
  })
})
