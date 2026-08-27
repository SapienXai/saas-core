import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { completeClaimForUser, createBusinessReservationAccess, getPublicRestaurantClaimState, hashReservationManageToken, createReservationManageToken } from "../lib/claimable-restaurants"
import { respondToReservationViaToken, resolveReservationManagementToken } from "../lib/reservation-management"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const describeLocal = /^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(url) && Boolean(anonKey && serviceRoleKey) ? describe : describe.skip

describeLocal("Reservevia claimable restaurant engine", () => {
  let service: SupabaseClient
  let ownerId = ""
  let ownerEmail = ""
  const ownerPassword = "ReserveviaClaim!2026"
  const workspaceIds: string[] = []
  let provisionCount = 0

  beforeAll(async () => {
    service = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    ownerEmail = `claim-owner-${Date.now()}@chain.example`
    const created = await service.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true })
    if (created.error || !created.data.user) throw created.error ?? new Error("Could not create claim test user")
    ownerId = created.data.user.id
  })

  afterAll(async () => {
    for (const workspaceId of workspaceIds) await service.from("workspaces").delete().eq("id", workspaceId)
    if (ownerId) await service.auth.admin.deleteUser(ownerId)
  })

  async function provision(input: Record<string, unknown>) {
    const slug = `${String(input.slug)}-${Date.now()}-${provisionCount++}`
    const result = await service.rpc("provision_restaurant_workspace", {
      target_restaurant_name: input.name,
      target_workspace_name: `${input.name} workspace`,
      target_restaurant_slug: slug,
      target_workspace_id: null,
      target_owner_user_id: null,
      target_restaurant_status: "published",
      target_claim_status: "unclaimed",
      target_source: "platform_manual",
      target_business_contact_email: input.email,
      target_official_website_url: input.website,
      target_official_domain: input.domain,
      target_source_import_id: null,
      target_profile: {},
    } as any)
    if (result.error || !result.data?.[0]) throw result.error ?? new Error("Provisioning failed")
    workspaceIds.push(result.data[0].workspace_id)
    return result.data[0]
  }

  it("provisions a live unclaimed restaurant with its own Free workspace and defaults", async () => {
    const provisioned = await provision({ name: "Harbor House", slug: "harbor-house-claim-test", email: "contact@harborhouse.example", website: "https://harborhouse.example", domain: "harborhouse.example" })
    const [restaurant, workspace, subscription, settings, profile] = await Promise.all([
      service.from("restaurants").select("id, workspace_id, status, reservation_enabled").eq("id", provisioned.restaurant_id).single(),
      service.from("workspaces").select("id, created_by").eq("id", provisioned.workspace_id).single(),
      service.from("workspace_subscriptions").select("plan_key, source").eq("workspace_id", provisioned.workspace_id).single(),
      service.from("notification_settings").select("restaurant_id").eq("restaurant_id", provisioned.restaurant_id).single(),
      service.from("restaurant_claim_profiles").select("ownership_status, source, business_contact_email, official_domain").eq("restaurant_id", provisioned.restaurant_id).single(),
    ])
    expect(restaurant.data).toMatchObject({ workspace_id: provisioned.workspace_id, status: "published", reservation_enabled: true })
    expect(workspace.data?.created_by).toBeNull()
    expect(subscription.data).toEqual({ plan_key: "free", source: "free" })
    expect(settings.data?.restaurant_id).toBe(provisioned.restaurant_id)
    expect(profile.data).toMatchObject({ ownership_status: "unclaimed", source: "platform_manual", business_contact_email: "contact@harborhouse.example", official_domain: "harborhouse.example" })
  })

  it("updates a platform restaurant in place and preserves blank contact fields", async () => {
    const provisioned = await provision({ name: `Import Update House ${Date.now()}`, slug: "import-update-house", email: "contact@importupdate.example", website: "https://importupdate.example", domain: "importupdate.example" })
    const before = await service.from("restaurants").select("id, slug, workspace_id").eq("id", provisioned.restaurant_id).single()
    const update = await service.rpc("update_platform_restaurant_from_import", {
      target_restaurant_id: provisioned.restaurant_id,
      target_payload: {
        name: "Import Update House Renamed",
        business_contact_email: "",
        official_website_url: "",
        description: "Updated from the current restaurant workbook.",
      },
      target_provided_fields: ["name", "description"],
    })
    expect(update.error).toBeNull()
    expect(update.data?.[0]).toMatchObject({ restaurant_id: provisioned.restaurant_id, workspace_id: provisioned.workspace_id, restaurant_slug: before.data?.slug })
    const [afterRestaurant, afterProfile] = await Promise.all([
      service.from("restaurants").select("name, slug, workspace_id, description").eq("id", provisioned.restaurant_id).single(),
      service.from("restaurant_claim_profiles").select("business_contact_email, official_website_url").eq("restaurant_id", provisioned.restaurant_id).single(),
    ])
    expect(afterRestaurant.data).toMatchObject({ name: "Import Update House Renamed", slug: before.data?.slug, workspace_id: before.data?.workspace_id, description: "Updated from the current restaurant workbook." })
    expect(afterProfile.data).toMatchObject({ business_contact_email: "contact@importupdate.example", official_website_url: "https://importupdate.example" })
  })

  it("keeps private claim metadata inaccessible to anon and ordinary authenticated users", async () => {
    const provisioned = await provision({ name: "Private Claim House", slug: "private-claim-house", email: "contact@privateclaim.example", website: "https://privateclaim.example", domain: "privateclaim.example" })
    const anonymous = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const anonRead = await anonymous.from("restaurant_claim_profiles").select("business_contact_email").eq("restaurant_id", provisioned.restaurant_id)
    expect(anonRead.data || []).toEqual([])
    const authenticated = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    await authenticated.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })
    const authRead = await authenticated.from("restaurant_claim_profiles").select("business_contact_email").eq("restaurant_id", provisioned.restaurant_id)
    expect(authRead.data || []).toEqual([])
    const importRead = await anonymous.from("platform_restaurant_imports").select("id")
    expect(importRead.data || []).toEqual([])
  })

  it("claims the existing workspace with exact verified email without moving restaurant ownership", async () => {
    const provisioned = await provision({ name: "Claim Me House", slug: "claim-me-house", email: ownerEmail, website: "https://ownerhouse.example", domain: "ownerhouse.example" })
    const before = await service.from("restaurants").select("workspace_id").eq("id", provisioned.restaurant_id).single()
    const result = await completeClaimForUser({ restaurantId: provisioned.restaurant_id, userId: ownerId, auditAction: "restaurant.claimed" })
    expect(result.success).toBe(true)
    const [after, membership, profile] = await Promise.all([
      service.from("restaurants").select("workspace_id").eq("id", provisioned.restaurant_id).single(),
      service.from("workspace_members").select("role").eq("workspace_id", provisioned.workspace_id).eq("user_id", ownerId).single(),
      service.from("restaurant_claim_profiles").select("ownership_status, claimed_by_user_id").eq("restaurant_id", provisioned.restaurant_id).single(),
    ])
    expect(after.data?.workspace_id).toBe(before.data?.workspace_id)
    expect(membership.data?.role).toBe("owner")
    expect(profile.data).toMatchObject({ ownership_status: "claimed", claimed_by_user_id: ownerId })
    expect((await getPublicRestaurantClaimState(provisioned.restaurant_id)).isClaimable).toBe(false)
    const repeated = await completeClaimForUser({ restaurantId: provisioned.restaurant_id, userId: ownerId })
    expect(repeated.success).toBe(true)
  })

  it("does not auto-claim consumer email or ambiguous shared domains", async () => {
    const consumer = await provision({ name: "Consumer Email House", slug: "consumer-email-house", email: "contact@consumerhouse.example", website: "https://consumerhouse.example", domain: "consumerhouse.example" })
    const consumerResult = await completeClaimForUser({ restaurantId: consumer.restaurant_id, userId: ownerId })
    expect(consumerResult.success).toBe(false)
    const pendingProfile = await service.from("restaurant_claim_profiles").select("ownership_status").eq("restaurant_id", consumer.restaurant_id).single()
    expect(pendingProfile.data?.ownership_status).toBe("claim_pending")

    const first = await provision({ name: "Chain One", slug: "chain-one-house", email: "contact@chain.example", website: "https://chain.example/one", domain: "chain.example" })
    const second = await provision({ name: "Chain Two", slug: "chain-two-house", email: "contact2@chain.example", website: "https://chain.example/two", domain: "chain.example" })
    const sharedDomain = await completeClaimForUser({ restaurantId: first.restaurant_id, userId: ownerId })
    expect(sharedDomain.success).toBe(false)
    expect(sharedDomain.status).toBe("shared_domain_manual_review")
    const memberships = await service.from("workspace_members").select("workspace_id").eq("user_id", ownerId).in("workspace_id", [first.workspace_id, second.workspace_id])
    expect(memberships.data || []).toHaveLength(0)
  })

  it("rolls back failed provisioning instead of leaving an orphan workspace", async () => {
    const slug = `failed-provision-${Date.now()}`
    const result = await service.rpc("provision_restaurant_workspace", {
      target_restaurant_name: "Failed Provision",
      target_workspace_name: "Failed Provision Workspace",
      target_restaurant_slug: slug,
      target_workspace_id: null,
      target_owner_user_id: null,
      target_restaurant_status: "published",
      target_claim_status: "unclaimed",
      target_source: "platform_manual",
      target_business_contact_email: "contact@failed.example",
      target_official_website_url: "https://failed.example",
      target_official_domain: "failed.example",
      target_source_import_id: null,
      target_profile: { opening_time: "23:00", closing_time: "10:00" },
    } as any)
    expect(result.error).not.toBeNull()
    const workspace = await service.from("workspaces").select("id").eq("slug", "failed-provision-workspace").maybeSingle()
    expect(workspace.data).toBeNull()
  })

  it("keeps unclaimed reservations pending and supports secure accountless outcomes", async () => {
    const provisioned = await provision({ name: "Reservation Request House", slug: "reservation-request-house", email: "contact@requesthouse.example", website: "https://requesthouse.example", domain: "requesthouse.example" })
    const reservation = await service.from("reservations").insert({
      restaurant_id: provisioned.restaurant_id,
      customer_name: "Ayse Yilmaz",
      customer_phone: "+90 532 000 00 00",
      customer_email: "ayse@example.com",
      party_size: 4,
      reservation_date: "2027-05-18",
      reservation_time: "20:30",
      special_requests: "Window seat",
      status: "pending",
      reservation_type: "meal",
      booking_source: "online",
    }).select("id, status").single()
    if (reservation.error || !reservation.data) throw reservation.error ?? new Error("Could not create reservation fixture")
    const access = await createBusinessReservationAccess({ restaurantId: provisioned.restaurant_id, reservationId: reservation.data.id, businessEmail: "contact@requesthouse.example" })
    const manageToken = access.manageUrl.split("/").pop() || ""
    const claimToken = new URL(access.claimUrl).searchParams.get("token") || ""
    const [claimRow, manageRow, view] = await Promise.all([
      service.from("restaurant_claims").select("token_hash, requested_email").eq("reservation_id", reservation.data.id).single(),
      service.from("reservation_management_tokens").select("token_hash, consumed_at").eq("reservation_id", reservation.data.id).single(),
      resolveReservationManagementToken(manageToken),
    ])
    expect(claimRow.data?.token_hash).toBeDefined()
    expect(claimRow.data?.token_hash).not.toContain(claimToken)
    expect(manageRow.data?.token_hash).toBe(hashReservationManageToken(manageToken))
    expect(view).toMatchObject({ reservationId: reservation.data.id, status: "pending", customerName: "Ayse Yilmaz" })

    const accepted = await respondToReservationViaToken(manageToken, "confirmed")
    expect(accepted).toMatchObject({ success: true, status: "confirmed" })
    const repeated = await respondToReservationViaToken(manageToken, "confirmed")
    expect(repeated).toMatchObject({ success: true, idempotent: true })
    const updated = await service.from("reservations").select("status").eq("id", reservation.data.id).single()
    expect(updated.data?.status).toBe("confirmed")
    const invalidTransition = await respondToReservationViaToken(manageToken, "cancelled")
    expect(invalidTransition.success).toBe(false)

    const expiredToken = createReservationManageToken()
    await service.from("reservation_management_tokens").insert({ reservation_id: reservation.data.id, restaurant_id: provisioned.restaurant_id, token_hash: hashReservationManageToken(expiredToken), expires_at: "2020-01-01T00:00:00.000Z" })
    expect((await respondToReservationViaToken(expiredToken, "cancelled")).success).toBe(false)
    expect((await respondToReservationViaToken("not-a-real-token", "cancelled")).success).toBe(false)
  })
})
