import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { fetchPublicRestaurantProfileBySlug } from "../lib/services/public/restaurant-service"
import { applyPaddleSubscriptionEvent, processStoredPaddleWebhookEvent, recordPaddleWebhookEvent, type NormalizedPaddleEvent } from "../lib/billing/webhook"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const isLocalConfiguration =
  /^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(url) &&
  Boolean(anonKey && serviceRoleKey)

const describeLocal = isLocalConfiguration ? describe : describe.skip

type LocalUser = {
  id: string
  email: string
  password: string
  client: SupabaseClient
}

const FELIX_BEACH_ID = "00000000-0000-4000-8000-000000000001"
const TEST_RESTAURANT_ID = "00000000-0000-4000-8000-000000000011"
const FELIX_AREA_ID = "00000000-0000-4000-8000-000000000012"
const TEST_AREA_ID = "00000000-0000-4000-8000-000000000013"

let service: SupabaseClient
let userA: LocalUser
let userB: LocalUser
let felixWorkspaceId = ""
let testWorkspaceId = ""
let insertedReservationId = ""
let insertedPushSubscriptionId = ""
let insertedWorkspacePushSubscriptionId = ""
let uploadedAssetPath = ""
let insertedDomainId = ""

async function createLocalUser(label: string): Promise<LocalUser> {
  const password = "ReserveviaLocalTest!2026"
  const email = `reservevia-${label}-${Date.now()}@example.test`
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    throw error ?? new Error(`Could not create local test user ${label}`)
  }

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })

  if (signInError) {
    throw signInError
  }

  return { id: data.user.id, email, password, client }
}

async function expectNoError<T>(result: PromiseLike<{ data: T; error: Error | null }>) {
  const { data, error } = await result
  expect(error).toBeNull()
  return data
}

describeLocal("Reservevia Supabase RLS isolation", () => {
  beforeAll(async () => {
    service = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: felixWorkspace, error: felixWorkspaceError } = await service
      .from("workspaces")
      .select("id")
      .eq("slug", "felix-restaurants")
      .single()
    if (felixWorkspaceError || !felixWorkspace) throw felixWorkspaceError
    felixWorkspaceId = felixWorkspace.id

    const { data: testWorkspace, error: testWorkspaceError } = await service
      .from("workspaces")
      .select("id")
      .eq("slug", "test-restaurant-group")
      .single()
    if (testWorkspaceError || !testWorkspace) throw testWorkspaceError
    testWorkspaceId = testWorkspace.id

    userA = await createLocalUser("workspace-a")
    userB = await createLocalUser("workspace-b")

    await expectNoError(service.from("admin_profiles").insert([
      { id: userA.id, full_name: "Workspace A Manager", role: "manager", restaurant_id: FELIX_BEACH_ID },
      { id: userB.id, full_name: "Workspace B Manager", role: "manager", restaurant_id: TEST_RESTAURANT_ID },
    ]))
    await expectNoError(service.from("workspace_members").insert([
      { workspace_id: felixWorkspaceId, user_id: userA.id, role: "manager" },
      { workspace_id: testWorkspaceId, user_id: userB.id, role: "manager" },
    ]))
  })

  afterAll(async () => {
    if (!service) return
    if (insertedPushSubscriptionId) {
      await service.from("admin_push_subscriptions").delete().eq("id", insertedPushSubscriptionId)
    }
    if (insertedWorkspacePushSubscriptionId) {
      await service.from("workspace_push_subscriptions").delete().eq("id", insertedWorkspacePushSubscriptionId)
    }
    if (insertedReservationId) {
      await service.from("reservations").delete().eq("id", insertedReservationId)
    }
    if (uploadedAssetPath) {
      await service.storage.from("restaurant-assets").remove([uploadedAssetPath])
    }
    if (insertedDomainId) {
      await service.from("restaurant_domains").delete().eq("id", insertedDomainId)
    }
    if (userA?.id) {
      await service.from("workspace_members").delete().eq("user_id", userA.id)
      await service.from("admin_profiles").delete().eq("id", userA.id)
      await service.auth.admin.deleteUser(userA.id)
    }
    if (userB?.id) {
      await service.from("workspace_members").delete().eq("user_id", userB.id)
      await service.from("admin_profiles").delete().eq("id", userB.id)
      await service.auth.admin.deleteUser(userB.id)
    }
  })

  it("lets an authenticated member read only their workspace and restaurants", async () => {
    const ownWorkspaces = await expectNoError(userA.client.from("workspaces").select("id, slug"))
    expect(ownWorkspaces).toEqual([{ id: felixWorkspaceId, slug: "felix-restaurants" }])

    const foreignWorkspaces = await expectNoError(
      userA.client.from("workspaces").select("id").eq("id", testWorkspaceId),
    )
    expect(foreignWorkspaces).toEqual([])

    const ownRestaurants = await expectNoError(
      userA.client.from("restaurants").select("id, name").eq("workspace_id", felixWorkspaceId),
    )
    expect(ownRestaurants).toHaveLength(4)

    const foreignRestaurants = await expectNoError(
      userA.client.from("restaurants").select("id").eq("id", TEST_RESTAURANT_ID),
    )
    expect(foreignRestaurants).toEqual([])
  })

  it("protects reservations, areas, settings, and media across tenants", async () => {
    const ownReservations = await expectNoError(
      userA.client.from("reservations").select("id").eq("restaurant_id", FELIX_BEACH_ID),
    )
    expect(ownReservations).toHaveLength(1)

    const foreignReservations = await expectNoError(
      userA.client.from("reservations").select("id").eq("restaurant_id", TEST_RESTAURANT_ID),
    )
    expect(foreignReservations).toEqual([])

    const ownAreas = await expectNoError(
      userA.client.from("reservation_areas").select("id").eq("restaurant_id", FELIX_BEACH_ID),
    )
    expect(ownAreas).toHaveLength(1)

    const foreignSettings = await expectNoError(
      userA.client.from("notification_settings").select("restaurant_id").eq("restaurant_id", TEST_RESTAURANT_ID),
    )
    expect(foreignSettings).toEqual([])

    const ownMedia = await expectNoError(
      userA.client.from("restaurant_media").select("id").eq("restaurant_id", FELIX_BEACH_ID),
    )
    expect(ownMedia).toHaveLength(2)

    const foreignMedia = await expectNoError(
      userA.client.from("restaurant_media").select("id").eq("restaurant_id", TEST_RESTAURANT_ID),
    )
    expect(foreignMedia).toEqual([])
  })

  it("protects plan state and usage while exposing the safe active catalog", async () => {
    const plans = await expectNoError(userA.client.from("plans").select("key, monthly_price_usd_cents, restaurant_limit, user_limit, reservation_limit, history_days, features").order("key"))
    expect(plans || []).toHaveLength(4)
    expect((plans || []).find((plan) => plan.key === "free")).toMatchObject({
      monthly_price_usd_cents: 0,
      restaurant_limit: 1,
      user_limit: 1,
      reservation_limit: 100,
      history_days: 30,
    })
    expect((plans || []).find((plan) => plan.key === "pro")).toMatchObject({ reservation_limit: null, history_days: null })
    expect(plans || []).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "starter", monthly_price_usd_cents: 1900, restaurant_limit: 1, user_limit: 3, reservation_limit: 500, history_days: 365 }),
      expect.objectContaining({ key: "business", monthly_price_usd_cents: 9900, restaurant_limit: 3, user_limit: 20, reservation_limit: null, history_days: null }),
    ]))

    const ownSubscription = await expectNoError(
      userA.client.from("workspace_subscriptions").select("workspace_id, plan_key").eq("workspace_id", felixWorkspaceId),
    )
    expect(ownSubscription).toEqual([{ workspace_id: felixWorkspaceId, plan_key: "business" }])

    const foreignSubscription = await expectNoError(
      userA.client.from("workspace_subscriptions").select("workspace_id").eq("workspace_id", testWorkspaceId),
    )
    expect(foreignSubscription).toEqual([])

    const usage = await expectNoError(
      userA.client.from("workspace_usage_periods").select("workspace_id, reservations_created").eq("workspace_id", felixWorkspaceId),
    )
    expect(usage).toHaveLength(1)

    const forgedPlanUpdate = await userA.client.from("workspace_subscriptions").update({ plan_key: "pro" }).eq("workspace_id", felixWorkspaceId)
    expect(forgedPlanUpdate.error).not.toBeNull()
    const forgedUsageUpdate = await userA.client.from("workspace_usage_periods").update({ reservations_created: 0 }).eq("workspace_id", felixWorkspaceId)
    expect(forgedUsageUpdate.error).not.toBeNull()
  })

  it("keeps public reservation abuse counters atomic and service-role-only", async () => {
    const keyHash = `${"a".repeat(63)}b`
    await service.from("public_reservation_rate_limits").delete().eq("key_hash", keyHash)

    const first = await service.rpc("consume_public_reservation_rate_limit", {
      p_key_hash: keyHash,
      p_window_seconds: 60,
      p_max_attempts: 1,
    })
    expect(first.error).toBeNull()
    expect(first.data).toBe(true)

    const second = await service.rpc("consume_public_reservation_rate_limit", {
      p_key_hash: keyHash,
      p_window_seconds: 60,
      p_max_attempts: 1,
    })
    expect(second.error).toBeNull()
    expect(second.data).toBe(false)

    const anonymous = createClient(url, anonKey, { auth: { persistSession: false } })
    const forged = await anonymous.rpc("consume_public_reservation_rate_limit", {
      p_key_hash: keyHash,
      p_window_seconds: 60,
      p_max_attempts: 1,
    })
    expect(forged.data).toBeNull()
    expect(forged.error).not.toBeNull()

    await service.from("public_reservation_rate_limits").delete().eq("key_hash", keyHash)
  })

  it("keeps email outbox invocation runs service-role-only", async () => {
    const anonymous = createClient(url, anonKey, { auth: { persistSession: false } })
    const anonymousRead = await anonymous.from("email_outbox_runs").select("id")
    expect(anonymousRead.data).toBeNull()
    expect(anonymousRead.error).not.toBeNull()

    const authenticatedRead = await userA.client.from("email_outbox_runs").select("id")
    expect(authenticatedRead.data).toBeNull()
    expect(authenticatedRead.error).not.toBeNull()

    const serviceRead = await service.from("email_outbox_runs").select("id").limit(0)
    expect(serviceRead.error).toBeNull()
  })

  it("keeps Paddle mappings and webhook state server-controlled", async () => {
    const mapping = await service.from("billing_provider_prices").insert({
      provider: "paddle",
      environment: "sandbox",
      plan_key: "starter",
      provider_product_id: "pro_local_test",
      provider_price_id: "pri_local_starter_test",
      billing_interval: "month",
      currency: "USD",
      active: true,
    }).select("id").single()
    expect(mapping.error).toBeNull()

    const hiddenMapping = await userA.client.from("billing_provider_prices").select("provider_price_id")
    expect(hiddenMapping.error).not.toBeNull()
    const hiddenWebhook = await userA.client.from("billing_webhook_events").select("id")
    expect(hiddenWebhook.error).not.toBeNull()
    const hiddenCheckout = await userA.client.from("billing_checkout_sessions").select("id")
    expect(hiddenCheckout.error).not.toBeNull()

    const forgedMapping = await userA.client.from("billing_provider_prices").insert({
      provider: "paddle",
      environment: "sandbox",
      plan_key: "starter",
      provider_product_id: "forged_product",
      provider_price_id: "forged_price",
    })
    expect(forgedMapping.error).not.toBeNull()

    const forgedSubscription = await userA.client.from("workspace_subscriptions").update({
      provider: "paddle",
      provider_environment: "sandbox",
      provider_subscription_id: "sub_forged",
      plan_key: "pro",
    }).eq("workspace_id", felixWorkspaceId)
    expect(forgedSubscription.error).not.toBeNull()

    const event = (eventId: string, occurredAt: string, status: "active" | "past_due" | "canceled"): NormalizedPaddleEvent => ({
      eventId,
      eventType: `subscription.${status === "active" ? "activated" : status}`,
      occurredAt,
      data: {
        id: "sub_local_test",
        status,
        customerId: "ctm_local_test",
        currentBillingPeriod: { startsAt: "2026-08-01T00:00:00Z", endsAt: "2026-09-01T00:00:00Z" },
        customData: { reservevia_workspace_id: testWorkspaceId, reservevia_billing_environment: "sandbox" },
        items: [{ price: { id: "pri_local_starter_test" }, quantity: 1 }],
      },
    })

    try {
      const activatedEvent = event("evt_local_1", "2026-08-09T10:00:00Z", "active")
      const stored = await recordPaddleWebhookEvent(activatedEvent)
      const duplicate = await recordPaddleWebhookEvent(activatedEvent)
      expect(stored.duplicate).toBe(false)
      expect(duplicate.duplicate).toBe(true)
      expect(await processStoredPaddleWebhookEvent(stored.id)).toBe("processed")
      expect(await processStoredPaddleWebhookEvent(stored.id)).toBe("processed")

      const activated = await service.from("workspace_subscriptions").select("plan_key, provider_status").eq("workspace_id", testWorkspaceId).single()
      expect(activated.data).toEqual({ plan_key: "starter", provider_status: "active" })

      const older = await applyPaddleSubscriptionEvent(event("evt_local_old", "2026-08-09T09:00:00Z", "active"))
      expect(older).toMatchObject({ status: "ignored", reason: "OUT_OF_ORDER" })

      const pastDue = await applyPaddleSubscriptionEvent(event("evt_local_2", "2026-08-10T10:00:00Z", "past_due"))
      expect(pastDue).toMatchObject({ status: "processed", planKey: "starter" })

      const canceled = await applyPaddleSubscriptionEvent(event("evt_local_3", "2026-08-11T10:00:00Z", "canceled"))
      expect(canceled).toMatchObject({ status: "processed", planKey: "free" })

      const finalState = await service.from("workspace_subscriptions").select("plan_key, provider_status, last_provider_event_id").eq("workspace_id", testWorkspaceId).single()
      expect(finalState.error).toBeNull()
      expect(finalState.data).toEqual({ plan_key: "free", provider_status: "canceled", last_provider_event_id: "evt_local_3" })
    } finally {
      await service.from("workspace_subscriptions").update({
        plan_key: "free",
        status: "active",
        source: "free",
        provider: null,
        provider_environment: null,
        provider_customer_id: null,
        provider_subscription_id: null,
        provider_price_id: null,
        provider_status: null,
        last_provider_event_at: null,
        last_provider_event_id: null,
        next_billed_at: null,
        scheduled_change_at: null,
        scheduled_change_action: null,
        billing_issue_code: null,
        payment_failure_started_at: null,
        payment_grace_ends_at: null,
      }).eq("workspace_id", testWorkspaceId)
      if (mapping.data?.id) await service.from("billing_provider_prices").delete().eq("id", mapping.data.id)
    }
  })

  it("protects workspace PWA branding and scopes device push subscriptions", async () => {
    const pwaRead = await expectNoError(
      userA.client.from("workspace_pwa_settings").select("workspace_id, app_name").eq("workspace_id", felixWorkspaceId),
    )
    expect(pwaRead).toEqual([])

    const forgedPwa = await userA.client.from("workspace_pwa_settings").insert({
      workspace_id: felixWorkspaceId,
      app_name: "Forged PWA",
    })
    expect(forgedPwa.error).not.toBeNull()

    const ownPush = await userA.client.from("workspace_push_subscriptions").insert({
      workspace_id: felixWorkspaceId,
      user_id: userA.id,
      endpoint: `https://push.example.test/${userA.id}`,
      p256dh: "test-p256dh-key",
      auth: "test-auth-key",
    }).select("id").single()
    expect(ownPush.error).toBeNull()
    insertedWorkspacePushSubscriptionId = ownPush.data?.id || ""

    const foreignPush = await userA.client.from("workspace_push_subscriptions").insert({
      workspace_id: testWorkspaceId,
      user_id: userA.id,
      endpoint: `https://push.example.test/foreign/${userA.id}`,
      p256dh: "test-p256dh-key",
      auth: "test-auth-key",
    })
    expect(foreignPush.error).not.toBeNull()
  })

  it("protects custom domains with tenant RLS and database uniqueness", async () => {
    const inserted = await service.from("restaurant_domains").insert({
      restaurant_id: FELIX_BEACH_ID,
      hostname: "booking.felix-local.test",
      status: "active",
      provider: "vercel",
      provider_environment: "preview",
      verification_state: "verified",
      provider_verified: true,
      dns_configured: true,
    }).select("id").single()
    expect(inserted.error).toBeNull()
    insertedDomainId = inserted.data?.id || ""

    const own = await expectNoError(userA.client.from("restaurant_domains").select("hostname").eq("restaurant_id", FELIX_BEACH_ID))
    expect(own).toEqual([{ hostname: "booking.felix-local.test" }])

    const foreign = await expectNoError(userB.client.from("restaurant_domains").select("hostname").eq("restaurant_id", FELIX_BEACH_ID))
    expect(foreign).toEqual([])

    const forgedInsert = await userA.client.from("restaurant_domains").insert({
      restaurant_id: TEST_RESTAURANT_ID,
      hostname: "forged.felix-local.test",
    })
    expect(forgedInsert.error).not.toBeNull()

    const forgedUpdate = await userA.client.from("restaurant_domains").update({ status: "active", provider_verified: true }).eq("id", insertedDomainId)
    expect(forgedUpdate.error).not.toBeNull()

    const duplicateHostname = await service.from("restaurant_domains").insert({
      restaurant_id: TEST_RESTAURANT_ID,
      hostname: "booking.felix-local.test",
    })
    expect(duplicateHostname.error).not.toBeNull()

    const duplicateRestaurant = await service.from("restaurant_domains").insert({
      restaurant_id: FELIX_BEACH_ID,
      hostname: "another.felix-local.test",
    })
    expect(duplicateRestaurant.error).not.toBeNull()
  })

  it("allows a permitted reservation operation and rejects forged ownership", async () => {
    insertedReservationId = crypto.randomUUID()
    const ownInsert = await userA.client.from("reservations").insert({
      id: insertedReservationId,
      restaurant_id: FELIX_BEACH_ID,
      reservation_area_id: FELIX_AREA_ID,
      customer_name: "Local RLS Guest",
      customer_phone: "+10000000003",
      customer_email: "rls@example.test",
      party_size: 2,
      reservation_date: "2099-01-01",
      reservation_time: "18:00",
      status: "pending",
      reservation_type: "meal",
      booking_source: "online",
    })
    expect(ownInsert.error).toBeNull()

    const ownUpdate = await userA.client
      .from("reservations")
      .update({ notes: "Updated by an authorized local member" })
      .eq("id", insertedReservationId)
    expect(ownUpdate.error).toBeNull()

    const forgedUpdate = await userA.client
      .from("reservations")
      .update({ notes: "This must never be written" })
      .eq("id", "00000000-0000-4000-8000-000000000022")
    expect(forgedUpdate.error).toBeNull()

    const foreignReservation = await service
      .from("reservations")
      .select("notes")
      .eq("id", "00000000-0000-4000-8000-000000000022")
      .single()
    expect(foreignReservation.error).toBeNull()
    expect(foreignReservation.data?.notes).not.toBe("This must never be written")
  })

  it("enforces the Free restaurant limit at the database boundary", async () => {
    const result = await userB.client.from("restaurants").insert({
      workspace_id: testWorkspaceId,
      name: "Second Test Restaurant",
      slug: `second-test-${Date.now()}`,
      status: "published",
      timezone: "UTC",
      language: "en",
    })
    expect(result.error).not.toBeNull()
    expect(result.error?.details).toContain("RESTAURANT_LIMIT_REACHED")

    const restaurants = await expectNoError(service.from("restaurants").select("id").eq("workspace_id", testWorkspaceId))
    expect(restaurants).toHaveLength(1)
  })

  it("enforces the Free member limit at the database boundary", async () => {
    const password = "ReserveviaLocalTest!2026"
    const email = `reservevia-member-limit-${Date.now()}@example.test`
    const { data: authData, error: authError } = await service.auth.admin.createUser({ email, password, email_confirm: true })
    expect(authError).toBeNull()
    expect(authData.user).toBeTruthy()

    const result = await service.from("workspace_members").insert({
      workspace_id: testWorkspaceId,
      user_id: authData.user!.id,
      role: "staff",
    })
    expect(result.error).not.toBeNull()
    expect(result.error?.details).toContain("USER_LIMIT_REACHED")

    await service.auth.admin.deleteUser(authData.user!.id)
  })

  it("rejects exactly one of two concurrent inserts at the Free quota boundary", async () => {
    const start = new Date()
    const periodStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString().slice(0, 10)
    const periodEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
    await expectNoError(
      service.from("workspace_usage_periods").upsert({
        workspace_id: testWorkspaceId,
        period_start: periodStart,
        period_end: periodEnd,
        reservations_created: 99,
      }, { onConflict: "workspace_id,period_start,period_end" }),
    )

    const reservationIds = [crypto.randomUUID(), crypto.randomUUID()]
    const results = await Promise.all(reservationIds.map((id, index) => userB.client.from("reservations").insert({
      id,
      restaurant_id: TEST_RESTAURANT_ID,
      reservation_area_id: TEST_AREA_ID,
      customer_name: `Quota Guest ${index}`,
      customer_phone: `+100000000${index + 4}`,
      customer_email: `quota-${index}@example.test`,
      party_size: 2,
      reservation_date: "2099-02-01",
      reservation_time: index === 0 ? "18:00" : "18:30",
      status: "pending",
      reservation_type: "meal",
      booking_source: "online",
    })))

    expect(results.filter((result) => !result.error)).toHaveLength(1)
    expect(results.filter((result) => result.error?.code === "P0001")).toHaveLength(1)

    const finalUsage = await service.from("workspace_usage_periods").select("reservations_created").eq("workspace_id", testWorkspaceId).eq("period_start", periodStart).single()
    expect(finalUsage.error).toBeNull()
    expect(finalUsage.data?.reservations_created).toBe(100)

    await service.from("reservations").delete().in("id", reservationIds)
    await expectNoError(service.from("workspace_usage_periods").update({ reservations_created: 1 }).eq("workspace_id", testWorkspaceId).eq("period_start", periodStart))
  })

  it("enforces the Starter 500-reservation boundary without refunding cancellations", async () => {
    const start = new Date()
    const periodStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString().slice(0, 10)
    const periodEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
    await expectNoError(service.from("workspace_subscriptions").update({ plan_key: "starter", source: "manual" }).eq("workspace_id", testWorkspaceId))
    await expectNoError(service.from("workspace_usage_periods").upsert({
      workspace_id: testWorkspaceId,
      period_start: periodStart,
      period_end: periodEnd,
      reservations_created: 499,
    }, { onConflict: "workspace_id,period_start,period_end" }))

    const allowedId = crypto.randomUUID()
    const rejectedId = crypto.randomUUID()
    const makeInsert = (id: string, time: string) => userB.client.from("reservations").insert({
      id,
      restaurant_id: TEST_RESTAURANT_ID,
      reservation_area_id: TEST_AREA_ID,
      customer_name: "Starter Boundary Guest",
      customer_phone: "+10000000008",
      customer_email: "starter-boundary@example.test",
      party_size: 2,
      reservation_date: "2099-03-01",
      reservation_time: time,
      status: "pending",
      reservation_type: "meal",
      booking_source: "online",
    })

    try {
      const allowed = await makeInsert(allowedId, "18:00")
      expect(allowed.error).toBeNull()
      const rejected = await makeInsert(rejectedId, "18:30")
      expect(rejected.error?.code).toBe("P0001")

      await expectNoError(service.from("reservations").update({ status: "cancelled" }).eq("id", allowedId))
      const usage = await service.from("workspace_usage_periods").select("reservations_created").eq("workspace_id", testWorkspaceId).eq("period_start", periodStart).single()
      expect(usage.data?.reservations_created).toBe(500)
    } finally {
      await service.from("reservations").delete().in("id", [allowedId, rejectedId])
      await service.from("workspace_usage_periods").update({ reservations_created: 1 }).eq("workspace_id", testWorkspaceId).eq("period_start", periodStart)
      await service.from("workspace_subscriptions").update({ plan_key: "free", source: "free" }).eq("workspace_id", testWorkspaceId)
    }
  })

  it("rejects a cross-tenant restaurant write and push subscription", async () => {
    const forgedRestaurantUpdate = await userA.client
      .from("restaurants")
      .update({ description: "Cross-tenant write" })
      .eq("id", TEST_RESTAURANT_ID)
    expect(forgedRestaurantUpdate.error).toBeNull()

    const foreignRestaurant = await service
      .from("restaurants")
      .select("description")
      .eq("id", TEST_RESTAURANT_ID)
      .single()
    expect(foreignRestaurant.error).toBeNull()
    expect(foreignRestaurant.data?.description).toBe("A local-only restaurant used for tenant isolation tests.")

    const ownPushSubscription = await userA.client
      .from("admin_push_subscriptions")
      .insert({
        user_id: userA.id,
        restaurant_id: FELIX_BEACH_ID,
        endpoint: `https://push.example.test/${userA.id}`,
        p256dh: "local-p256dh",
        auth: "local-auth",
      })
      .select("id")
      .single()
    expect(ownPushSubscription.error).toBeNull()
    insertedPushSubscriptionId = ownPushSubscription.data?.id ?? ""

    const foreignPushSubscription = await userA.client
      .from("admin_push_subscriptions")
      .insert({
        user_id: userA.id,
        restaurant_id: TEST_RESTAURANT_ID,
        endpoint: `https://push.example.test/foreign-${userA.id}`,
        p256dh: "local-p256dh",
        auth: "local-auth",
      })
    expect(foreignPushSubscription.error).not.toBeNull()
  })

  it("scopes restaurant asset uploads to the workspace and restaurant path", async () => {
    uploadedAssetPath = `${felixWorkspaceId}/${FELIX_BEACH_ID}/primary/rls-${Date.now()}.png`
    const ownUpload = await userA.client.storage
      .from("restaurant-assets")
      .upload(uploadedAssetPath, new Blob(["local-image"], { type: "image/png" }), {
        contentType: "image/png",
        upsert: false,
      })
    expect(ownUpload.error).toBeNull()

    const foreignUpload = await userA.client.storage
      .from("restaurant-assets")
      .upload(`${testWorkspaceId}/${TEST_RESTAURANT_ID}/primary/forged.png`, new Blob(["local-image"], { type: "image/png" }), {
        contentType: "image/png",
        upsert: false,
      })
    expect(foreignUpload.error).not.toBeNull()
  })

  it("resolves only published public profile fields by stable slug", async () => {
    const profile = await fetchPublicRestaurantProfileBySlug("felix-beach")
    expect(profile?.name).toBe("Felix Beach")
    expect(profile?.slug).toBe("felix-beach")
    expect(profile?.showReserveviaBranding).toBe(false)
    expect(profile).not.toHaveProperty("id")
    expect(profile).not.toHaveProperty("workspace_id")

    const freeProfile = await fetchPublicRestaurantProfileBySlug("test-restaurant")
    expect(freeProfile?.showReserveviaBranding).toBe(true)

    await expectNoError(service.from("restaurants").update({ status: "unpublished" }).eq("id", TEST_RESTAURANT_ID))
    expect(await fetchPublicRestaurantProfileBySlug("test-restaurant")).toBeNull()
    await expectNoError(service.from("restaurants").update({ status: "published" }).eq("id", TEST_RESTAURANT_ID))
  })
})
