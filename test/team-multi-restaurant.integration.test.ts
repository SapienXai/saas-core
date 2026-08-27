import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getPushRecipientsForRestaurant } from "../lib/push-service"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const local = /^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(url) && Boolean(anonKey && serviceRoleKey)
const describeLocal = local ? describe : describe.skip

type TestUser = { id: string; email: string; client: SupabaseClient }

function tokenHash(value: string) { return createHash("sha256").update(value).digest("hex") }

describeLocal("Reservevia team and multi-restaurant isolation", () => {
  let service: SupabaseClient
  let owner: TestUser
  let manager: TestUser
  let scopedManager: TestUser
  let workspaceId = ""
  let firstRestaurantId = ""
  let secondRestaurantId = ""

  async function createTestUser(label: string): Promise<TestUser> {
    const email = `reservevia-team-${label}-${Date.now()}@example.test`
    const password = "ReserveviaTeam!2026"
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data.user) throw created.error || new Error("Could not create test user")
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const login = await client.auth.signInWithPassword({ email, password })
    if (login.error) throw login.error
    return { id: created.data.user.id, email, client }
  }

  async function invite(invitedBy: TestUser, email: string, role: string, mode = "all", restaurantIds: string[] = []) {
    const token = `${role}-${email}-${Date.now()}-${Math.random()}`
    const result = await invitedBy.client.rpc("create_workspace_invitation", {
      target_workspace_id: workspaceId,
      target_email: email,
      target_role: role,
      target_access_mode: mode,
      target_selected_restaurant_ids: restaurantIds,
      target_token_hash: tokenHash(token),
    })
    return { result, tokenHash: tokenHash(token) }
  }

  beforeAll(async () => {
    service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    owner = await createTestUser("owner")
    manager = await createTestUser("manager")
    scopedManager = await createTestUser("scoped")
    const bootstrap = await owner.client.rpc("bootstrap_initial_workspace", {
      target_restaurant_name: `Team House ${Date.now()}`,
      target_workspace_name: `Team Workspace ${Date.now()}`,
      target_restaurant_slug: `team-workspace-${Date.now()}`,
    })
    if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Could not bootstrap test workspace")
    workspaceId = bootstrap.data[0].workspace_id
    firstRestaurantId = bootstrap.data[0].restaurant_id
    const { error } = await service.from("workspace_subscriptions").update({ plan_key: "starter", source: "manual" }).eq("workspace_id", workspaceId)
    if (error) throw error
  })

  afterAll(async () => {
    if (workspaceId) {
      await service.from("restaurants").delete().eq("workspace_id", workspaceId)
      await service.from("workspace_members").delete().eq("workspace_id", workspaceId)
      await service.from("workspaces").delete().eq("id", workspaceId)
    }
    for (const user of [owner, manager, scopedManager]) if (user?.id) await service.auth.admin.deleteUser(user.id)
  })

  it("reserves pending seats and stores only a token hash", async () => {
    const first = await invite(owner, manager.email, "manager")
    expect(first.result.error).toBeNull()
    const stored = await service.from("workspace_invitations").select("email, token_hash, role, expires_at").eq("workspace_id", workspaceId).eq("email", manager.email).single()
    expect(stored.error).toBeNull()
    expect(stored.data?.token_hash).toBe(first.tokenHash)
    expect(stored.data?.token_hash).not.toContain(manager.email)

    const secondEmail = `reservevia-team-pending-${Date.now()}@example.test`
    const thirdEmail = `reservevia-team-blocked-${Date.now()}@example.test`
    const second = await invite(owner, secondEmail, "staff")
    expect(second.result.error).toBeNull()
    const blocked = await invite(owner, thirdEmail, "staff")
    expect(blocked.result.error?.message).toContain("USER_LIMIT_REACHED")
  })

  it("accepts once for the matching email and does not create a new workspace", async () => {
    const stored = await service.from("workspace_invitations").select("token_hash").eq("workspace_id", workspaceId).eq("email", manager.email).single()
    const accepted = await manager.client.rpc("accept_workspace_invitation", { target_token_hash: stored.data?.token_hash })
    expect(accepted.error).toBeNull()
    expect(accepted.data?.[0]).toMatchObject({ workspace_id: workspaceId, role: "manager" })
    const replay = await manager.client.rpc("accept_workspace_invitation", { target_token_hash: stored.data?.token_hash })
    expect(replay.error?.message).toContain("INVITATION_ALREADY_ACCEPTED")
    const memberships = await service.from("workspace_members").select("workspace_id, role").eq("user_id", manager.id)
    expect(memberships.data).toEqual([{ workspace_id: workspaceId, role: "manager" }])
    const ownWorkspaces = await service.from("workspaces").select("id").eq("created_by", manager.id)
    expect(ownWorkspaces.data).toEqual([])
  })

  it("blocks direct membership, invitation, and scope writes from a browser client", async () => {
    const forgedMembership = await manager.client.from("workspace_members").update({ role: "admin" }).eq("workspace_id", workspaceId).eq("user_id", manager.id)
    expect(forgedMembership.error).not.toBeNull()
    const forgedInvitation = await manager.client.from("workspace_invitations").insert({ workspace_id: workspaceId, email: "forged@example.test", normalized_email: "forged@example.test", role: "staff", token_hash: tokenHash("forged"), expires_at: new Date(Date.now() + 86400000).toISOString() })
    expect(forgedInvitation.error).not.toBeNull()
  })

  it("blocks invitation acceptance for the wrong authenticated email", async () => {
    await service.from("workspace_subscriptions").update({ plan_key: "business" }).eq("workspace_id", workspaceId)
    const invitation = await invite(owner, scopedManager.email, "manager", "selected", [firstRestaurantId])
    expect(invitation.result.error).toBeNull()
    const wrong = await manager.client.rpc("accept_workspace_invitation", { target_token_hash: invitation.tokenHash })
    expect(wrong.error?.message).toContain("INVITATION_EMAIL_MISMATCH")
  })

  it("enforces Business restaurant creation concurrency and selected restaurant RLS", async () => {
    await service.from("workspace_invitations").update({ revoked_at: new Date().toISOString() }).eq("workspace_id", workspaceId).is("accepted_at", null)
    await service.from("workspace_subscriptions").update({ plan_key: "business" }).eq("workspace_id", workspaceId)
    const base = await service.from("restaurants").insert({ workspace_id: workspaceId, name: `Team Base ${Date.now()}`, slug: `team-base-${Date.now()}`, status: "unpublished" }).select("id").single()
    expect(base.error).toBeNull()
    const created = await Promise.all([
      service.from("restaurants").insert({ workspace_id: workspaceId, name: `Team Second ${Date.now()}`, slug: `team-second-${Date.now()}`, status: "unpublished" }).select("id").single(),
      service.from("restaurants").insert({ workspace_id: workspaceId, name: `Team Third ${Date.now()}`, slug: `team-third-${Date.now()}`, status: "unpublished" }).select("id").single(),
    ])
    expect(created.filter((result) => !result.error)).toHaveLength(1)
    expect(created.filter((result) => result.error?.message.includes("Restaurant limit reached"))).toHaveLength(1)
    const restaurants = await service.from("restaurants").select("id").eq("workspace_id", workspaceId).order("created_at")
    expect(restaurants.data).toHaveLength(3)
    secondRestaurantId = restaurants.data?.[1]?.id || ""
    const scopedInvite = await invite(owner, scopedManager.email, "manager", "selected", [firstRestaurantId])
    expect(scopedInvite.result.error).toBeNull()
    const accepted = await scopedManager.client.rpc("accept_workspace_invitation", { target_token_hash: scopedInvite.tokenHash })
    expect(accepted.error).toBeNull()
    const scopedMemberId = accepted.data?.[0]?.member_id
    const updatedScope = await owner.client.rpc("update_workspace_member", {
      target_workspace_id: workspaceId,
      target_member_id: scopedMemberId,
      target_role: "manager",
      target_access_mode: "selected",
      target_selected_restaurant_ids: [secondRestaurantId],
    })
    expect(updatedScope.error).toBeNull()
    const forgedScopeUpdate = await scopedManager.client.rpc("update_workspace_member", {
      target_workspace_id: workspaceId,
      target_member_id: scopedMemberId,
      target_role: "admin",
      target_access_mode: "all",
      target_selected_restaurant_ids: [],
    })
    expect(forgedScopeUpdate.error).not.toBeNull()

    const reservation = await service.from("reservations").insert({ restaurant_id: secondRestaurantId, customer_name: "Scope Test", customer_phone: "+10000000000", customer_email: "scope@example.test", party_size: 2, reservation_date: "2030-01-01", reservation_time: "18:00:00", status: "pending", reservation_type: "meal", booking_source: "online" }).select("id").single()
    expect(reservation.error).toBeNull()
    const allowed = await scopedManager.client.from("restaurants").select("id").eq("id", secondRestaurantId)
    const denied = await scopedManager.client.from("restaurants").select("id").eq("id", firstRestaurantId)
    const deniedReservations = await scopedManager.client.from("reservations").select("id").eq("restaurant_id", firstRestaurantId)
    expect(allowed.data).toHaveLength(1)
    expect(denied.data).toEqual([])
    expect(deniedReservations.data).toEqual([])
  })

  it("resolves push recipients using current restaurant access", async () => {
    const subscriptions = [
      { user_id: owner.id, endpoint: `https://push.example.test/owner/${owner.id}` },
      { user_id: manager.id, endpoint: `https://push.example.test/manager/${manager.id}` },
      { user_id: scopedManager.id, endpoint: `https://push.example.test/scoped/${scopedManager.id}` },
    ]
    const inserted = await service.from("workspace_push_subscriptions").insert(subscriptions.map((subscription) => ({
      workspace_id: workspaceId,
      user_id: subscription.user_id,
      endpoint: subscription.endpoint,
      p256dh: "test-p256dh-key",
      auth: "test-auth-key",
    })))
    expect(inserted.error).toBeNull()

    const firstRestaurant = await getPushRecipientsForRestaurant(firstRestaurantId)
    expect(firstRestaurant.subscriptions.map((subscription) => subscription.user_id)).toEqual(expect.arrayContaining([owner.id, manager.id]))
    expect(firstRestaurant.subscriptions.map((subscription) => subscription.user_id)).not.toContain(scopedManager.id)

    const secondRestaurant = await getPushRecipientsForRestaurant(secondRestaurantId)
    expect(secondRestaurant.subscriptions.map((subscription) => subscription.user_id)).toEqual(expect.arrayContaining([owner.id, manager.id, scopedManager.id]))

    await service.from("workspace_push_subscriptions").delete().eq("workspace_id", workspaceId)
  })
})
