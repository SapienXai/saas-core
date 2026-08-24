import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createInvitationToken, hashInvitationToken } from "../packages/core/src/invitations.js"

const enabled = process.env.SAAS_CORE_DB_INTEGRATION === "1"
const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const emailSuffix = `${Date.now()}@saas-core.test`

type User = { id: string; email: string; password: string }
type Fixture = { service: SupabaseClient; users: User[]; workspaces: string[]; planKey: string }
let fixture: Fixture | null = null

async function createAuthUser(service: SupabaseClient, email: string): Promise<User> {
  const password = "CoreIntegration-123!"
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (result.error || !result.data.user) throw new Error(result.error?.message ?? "Could not create integration user.")
  return { id: result.data.user.id, email, password }
}

async function signedInUser(user: User) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  if (result.error) throw new Error(result.error.message)
  return client
}

function requireFixture(): Fixture {
  if (!fixture) throw new Error("Fixture was not initialized.")
  return fixture
}

async function createWorkspace(client: SupabaseClient, name: string) {
  const f = requireFixture()
  const created = await client.rpc("create_workspace", { target_name: name, target_slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, target_timezone: "UTC" })
  if (created.error) throw new Error(created.error.message)
  const workspaceId = (Array.isArray(created.data) ? created.data[0] : created.data)?.id as string
  f.workspaces.push(workspaceId)
  const subscription = await f.service.from("workspace_subscriptions").update({ plan_key: f.planKey, status: "active" }).eq("workspace_id", workspaceId)
  if (subscription.error) throw new Error(subscription.error.message)
  return workspaceId
}

async function rpcError(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const result = await client.rpc(fn, args)
  expect(result.error, `${fn} unexpectedly succeeded`).not.toBeNull()
  return result.error
}

describe.skipIf(!enabled).sequential("SaaS Core authenticated Supabase integration", () => {
  beforeAll(async () => {
    if (!serviceRoleKey || !anonKey) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY for DB integration tests.")
    const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const labels = ["owner", "foreign", "member", "invitee", "accept-a", "accept-b", "platform"]
    const users = await Promise.all(labels.map((label) => createAuthUser(service, `${label}-${emailSuffix}`)))
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

  it("allows a member to read its workspace and blocks a foreign user", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const foreignClient = await signedInUser(f.users[1]!)
    const workspaceId = await createWorkspace(ownerClient, "Integration A")
    const own = await ownerClient.from("workspaces").select("id").eq("id", workspaceId)
    expect(own.error).toBeNull()
    expect(own.data).toHaveLength(1)
    const foreign = await foreignClient.from("workspaces").select("id").eq("id", workspaceId)
    expect(foreign.error).toBeNull()
    expect(foreign.data).toEqual([])
  })

  it("blocks foreign membership, subscription, usage, invitation, domain, PWA, and push reads", async () => {
    const f = requireFixture()
    const foreignClient = await signedInUser(f.users[1]!)
    const workspaceId = f.workspaces[0]!
    const token = createInvitationToken()
    const writes = await Promise.all([
      f.service.from("workspace_usage_periods").insert({ workspace_id: workspaceId, metric: "foreign.read", period_start: "2026-08-01", period_end: "2026-09-01", amount: 1 }),
      f.service.from("workspace_invitations").insert({ workspace_id: workspaceId, normalized_email: `hidden-${emailSuffix}`, role: "member", token_hash: hashInvitationToken(token), invited_by: f.users[0]!.id, expires_at: new Date(Date.now() + 86400000).toISOString() }),
      f.service.from("workspace_domains").insert({ workspace_id: workspaceId, hostname: `hidden-${Date.now()}.example.com` }),
      f.service.from("workspace_pwa_settings").insert({ workspace_id: workspaceId, app_name: "Hidden" }),
      f.service.from("workspace_push_subscriptions").insert({ workspace_id: workspaceId, user_id: f.users[0]!.id, endpoint: `https://push.example/${Date.now()}`, p256dh: "p256dh", auth: "auth" }),
    ])
    expect(writes.every((write) => write.error === null), writes.map((write) => write.error?.message).join(" | ")).toBe(true)
    for (const table of ["workspace_subscriptions", "workspace_usage_periods", "workspace_invitations", "workspace_domains", "workspace_pwa_settings", "workspace_push_subscriptions"] as const) {
      const result = await foreignClient.from(table).select("*").eq("workspace_id", workspaceId)
      expect(result.error, `${table} query failed`).toBeNull()
      expect(result.data, `${table} crossed tenant boundary`).toEqual([])
    }
  })

  it("rejects direct membership insert and direct role mutation", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = f.workspaces[0]!
    const forgedInsert = await ownerClient.from("workspace_members").insert({ workspace_id: workspaceId, user_id: f.users[1]!.id, role: "member" })
    expect(forgedInsert.error).not.toBeNull()
    const existing = await f.service.from("workspace_members").select("id").eq("workspace_id", workspaceId).eq("user_id", f.users[0]!.id).single()
    expect(existing.error).toBeNull()
    const forgedUpdate = await ownerClient.from("workspace_members").update({ role: "admin" }).eq("id", existing.data!.id)
    expect(forgedUpdate.error).toBeNull()
    const unchanged = await f.service.from("workspace_members").select("role").eq("id", existing.data!.id).single()
    expect(unchanged.data?.role).toBe("owner")
  })

  it("enforces owner and admin role hierarchy through RPCs", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = f.workspaces[0]!
    await f.service.from("workspace_members").upsert({ workspace_id: workspaceId, user_id: f.users[2]!.id, role: "member", status: "active" })
    const changed = await ownerClient.rpc("change_member_role", { target_workspace: workspaceId, target_user: f.users[2]!.id, target_role: "viewer" })
    expect(changed.error).toBeNull()
    await rpcError(ownerClient, "change_member_role", { target_workspace: workspaceId, target_user: f.users[0]!.id, target_role: "owner" })
    await rpcError(ownerClient, "remove_member", { target_workspace: workspaceId, target_user: f.users[0]!.id })
    await f.service.from("workspace_members").update({ role: "admin" }).eq("workspace_id", workspaceId).eq("user_id", f.users[2]!.id)
    const adminClient = await signedInUser(f.users[2]!)
    await rpcError(adminClient, "change_member_role", { target_workspace: workspaceId, target_user: f.users[0]!.id, target_role: "member" })
    await rpcError(adminClient, "change_member_role", { target_workspace: workspaceId, target_user: f.users[2]!.id, target_role: "admin" })
    await f.service.from("workspace_members").update({ role: "member" }).eq("workspace_id", workspaceId).eq("user_id", f.users[2]!.id)
  })

  it("blocks suspended members from workspace reads", async () => {
    const f = requireFixture()
    const memberClient = await signedInUser(f.users[2]!)
    const workspaceId = f.workspaces[0]!
    await f.service.from("workspace_members").update({ status: "suspended" }).eq("workspace_id", workspaceId).eq("user_id", f.users[2]!.id)
    const result = await memberClient.from("workspaces").select("id").eq("id", workspaceId)
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
    await f.service.from("workspace_members").update({ status: "active", role: "member" }).eq("workspace_id", workspaceId).eq("user_id", f.users[2]!.id)
  })

  it("blocks foreign membership and audit reads", async () => {
    const f = requireFixture()
    const foreignClient = await signedInUser(f.users[1]!)
    const workspaceId = f.workspaces[0]!
    const memberships = await foreignClient.from("workspace_members").select("id").eq("workspace_id", workspaceId)
    const audits = await foreignClient.from("audit_events").select("id").eq("entity_type", "workspace").eq("entity_id", workspaceId)
    expect(memberships.error).toBeNull()
    expect(memberships.data).toEqual([])
    expect(audits.error).toBeNull()
    expect(audits.data).toEqual([])
  })

  it("blocks manager membership mutations", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const managerClient = await signedInUser(f.users[2]!)
    const workspaceId = f.workspaces[0]!
    await f.service.from("workspace_members").update({ role: "manager" }).eq("workspace_id", workspaceId).eq("user_id", f.users[2]!.id)
    await rpcError(managerClient, "change_member_role", { target_workspace: workspaceId, target_user: f.users[0]!.id, target_role: "viewer" })
    await rpcError(managerClient, "remove_member", { target_workspace: workspaceId, target_user: f.users[0]!.id })
    await f.service.from("workspace_members").update({ role: "member" }).eq("workspace_id", workspaceId).eq("user_id", f.users[2]!.id)
    expect((await ownerClient.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", f.users[2]!.id).single()).data?.role).toBe("member")
  })

  it("enforces feature entitlement for custom domains", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = f.workspaces[0]!
    await rpcError(ownerClient, "create_workspace_domain", { target_workspace: workspaceId, target_hostname: `not-entitled-${Date.now()}.example.com` })
    const invalid = await ownerClient.rpc("create_workspace_domain", { target_workspace: workspaceId, target_hostname: "127.0.0.1" })
    expect(invalid.error).not.toBeNull()
  })

  it("requires owner or admin authorization for PWA settings", async () => {
    const f = requireFixture()
    const memberClient = await signedInUser(f.users[2]!)
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = f.workspaces[0]!
    await rpcError(memberClient, "upsert_workspace_pwa_settings", { target_workspace: workspaceId, target_app_name: "Blocked" })
    const allowed = await ownerClient.rpc("upsert_workspace_pwa_settings", { target_workspace: workspaceId, target_app_name: "Integration PWA" })
    expect(allowed.error).toBeNull()
    await f.service.from("workspace_pwa_settings").delete().eq("workspace_id", workspaceId)
  })

  it("scopes push subscriptions to the authenticated workspace member", async () => {
    const f = requireFixture()
    const memberClient = await signedInUser(f.users[2]!)
    const foreignClient = await signedInUser(f.users[1]!)
    const workspaceId = f.workspaces[0]!
    const endpoint = `https://push.example/integration-${Date.now()}`
    const created = await memberClient.rpc("upsert_push_subscription", { target_workspace: workspaceId, target_endpoint: endpoint, target_p256dh: "p256dh", target_auth: "auth" })
    expect(created.error).toBeNull()
    const foreign = await foreignClient.from("workspace_push_subscriptions").select("id").eq("workspace_id", workspaceId)
    expect(foreign.error).toBeNull()
    expect(foreign.data).toEqual([])
    await f.service.from("workspace_push_subscriptions").delete().eq("endpoint", endpoint)
  })

  it("keeps grace-expiry lifecycle mutation service-role only", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    await rpcError(ownerClient, "expire_payment_grace", {})
    const result = await f.service.rpc("expire_payment_grace", { target_at: new Date().toISOString() })
    expect(result.error).toBeNull()
  })

  it("normalizes invitation email addresses at the database boundary", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const token = createInvitationToken()
    const email = `MixedCase-${Date.now()}@Example.Test`
    const created = await ownerClient.rpc("create_workspace_invitation", { target_workspace: f.workspaces[0], target_email: email, target_role: "member", target_token_hash: hashInvitationToken(token), target_expires_at: new Date(Date.now() + 86400000).toISOString() })
    expect(created.error).toBeNull()
    const id = (Array.isArray(created.data) ? created.data[0] : created.data).id
    const stored = await f.service.from("workspace_invitations").select("normalized_email").eq("id", id).single()
    expect(stored.data?.normalized_email).toBe(email.toLowerCase())
  })

  it("creates invitations, rejects duplicates, and rotates resend tokens", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = f.workspaces[0]!
    const token = createInvitationToken()
    const created = await ownerClient.rpc("create_workspace_invitation", { target_workspace: workspaceId, target_email: `resend-${emailSuffix}`, target_role: "member", target_token_hash: hashInvitationToken(token), target_expires_at: new Date(Date.now() + 86400000).toISOString() })
    expect(created.error).toBeNull()
    const invitation = (Array.isArray(created.data) ? created.data[0] : created.data) as { id: string; token_hash: string }
    await rpcError(ownerClient, "create_workspace_invitation", { target_workspace: workspaceId, target_email: `resend-${emailSuffix}`, target_role: "member", target_token_hash: hashInvitationToken(createInvitationToken()), target_expires_at: new Date(Date.now() + 86400000).toISOString() })
    await f.service.from("workspace_invitations").update({ last_sent_at: new Date(Date.now() - 120000).toISOString() }).eq("id", invitation.id)
    const rotatedToken = createInvitationToken()
    const resent = await ownerClient.rpc("resend_workspace_invitation", { target_invitation: invitation.id, target_token_hash: hashInvitationToken(rotatedToken) })
    expect(resent.error).toBeNull()
    const stored = await f.service.from("workspace_invitations").select("token_hash,resend_count").eq("id", invitation.id).single()
    expect(stored.data?.token_hash).toBe(hashInvitationToken(rotatedToken))
    expect(stored.data?.resend_count).toBe(1)
    await rpcError(ownerClient, "resend_workspace_invitation", { target_invitation: invitation.id, target_token_hash: hashInvitationToken(createInvitationToken()) })
  })

  it("rejects wrong-email, expired, revoked, and replayed invitations", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const foreignClient = await signedInUser(f.users[1]!)
    const inviteeClient = await signedInUser(f.users[3]!)
    const workspaceId = f.workspaces[0]!
    const wrongToken = createInvitationToken()
    const wrong = await ownerClient.rpc("create_workspace_invitation", { target_workspace: workspaceId, target_email: f.users[3]!.email, target_role: "member", target_token_hash: hashInvitationToken(wrongToken), target_expires_at: new Date(Date.now() + 86400000).toISOString() })
    expect(wrong.error).toBeNull()
    const wrongId = (Array.isArray(wrong.data) ? wrong.data[0] : wrong.data).id
    await rpcError(foreignClient, "accept_workspace_invitation", { target_invitation: wrongId, target_token_hash: hashInvitationToken(wrongToken) })
    const accepted = await inviteeClient.rpc("accept_workspace_invitation", { target_invitation: wrongId, target_token_hash: hashInvitationToken(wrongToken) })
    expect(accepted.error).toBeNull()
    await rpcError(inviteeClient, "accept_workspace_invitation", { target_invitation: wrongId, target_token_hash: hashInvitationToken(wrongToken) })
    const expiredToken = createInvitationToken()
    const expired = await f.service.from("workspace_invitations").insert({ workspace_id: workspaceId, normalized_email: `expired-${emailSuffix}`, role: "member", token_hash: hashInvitationToken(expiredToken), invited_by: f.users[0]!.id, expires_at: new Date(Date.now() - 1000).toISOString() }).select("id").single()
    expect(expired.error).toBeNull()
    await rpcError(foreignClient, "accept_workspace_invitation", { target_invitation: expired.data!.id, target_token_hash: hashInvitationToken(expiredToken) })
    const revokedToken = createInvitationToken()
    const revoked = await ownerClient.rpc("create_workspace_invitation", { target_workspace: workspaceId, target_email: `revoked-${emailSuffix}`, target_role: "member", target_token_hash: hashInvitationToken(revokedToken), target_expires_at: new Date(Date.now() + 86400000).toISOString() })
    expect(revoked.error).toBeNull()
    const revokedId = (Array.isArray(revoked.data) ? revoked.data[0] : revoked.data).id
    expect((await ownerClient.rpc("revoke_workspace_invitation", { target_invitation: revokedId })).error).toBeNull()
    await rpcError(foreignClient, "accept_workspace_invitation", { target_invitation: revokedId, target_token_hash: hashInvitationToken(revokedToken) })
  })

  it("serializes concurrent invitation seat reservations", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = await createWorkspace(ownerClient, "Seat Race")
    const seatPlan = `seat-${Date.now()}`
    await f.service.from("plans").insert({ key: seatPlan, name: "Two seats", active: true, limits: { users: 2 }, features: {}, billing: {} })
    await f.service.from("workspace_subscriptions").update({ plan_key: seatPlan }).eq("workspace_id", workspaceId)
    const attempts = ["seat-a", "seat-b"].map((label) => { const token = createInvitationToken(); return ownerClient.rpc("create_workspace_invitation", { target_workspace: workspaceId, target_email: `${label}-${emailSuffix}`, target_role: "member", target_token_hash: hashInvitationToken(token), target_expires_at: new Date(Date.now() + 86400000).toISOString() }) })
    const results = await Promise.all(attempts)
    expect(results.filter((result) => !result.error)).toHaveLength(1)
    const pending = await f.service.from("workspace_invitations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pending")
    expect(pending.count).toBe(1)
  })

  it("serializes concurrent invitation acceptance seat allocation", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const firstClient = await signedInUser(f.users[4]!)
    const secondClient = await signedInUser(f.users[5]!)
    const workspaceId = await createWorkspace(ownerClient, "Acceptance Race")
    const seatPlan = `accept-seat-${Date.now()}`
    await f.service.from("plans").insert({ key: seatPlan, name: "Two seats", active: true, limits: { users: 2 }, features: {}, billing: {} })
    await f.service.from("workspace_subscriptions").update({ plan_key: seatPlan }).eq("workspace_id", workspaceId)
    const invitations = await Promise.all([f.users[4]!, f.users[5]!].map(async (user) => { const token = createInvitationToken(); const row = await f.service.from("workspace_invitations").insert({ workspace_id: workspaceId, normalized_email: user.email, role: "member", token_hash: hashInvitationToken(token), invited_by: f.users[0]!.id, expires_at: new Date(Date.now() + 86400000).toISOString() }).select("id").single(); if (row.error) throw new Error(row.error.message); return { id: row.data.id, token } }))
    const results = await Promise.all([firstClient.rpc("accept_workspace_invitation", { target_invitation: invitations[0]!.id, target_token_hash: hashInvitationToken(invitations[0]!.token) }), secondClient.rpc("accept_workspace_invitation", { target_invitation: invitations[1]!.id, target_token_hash: hashInvitationToken(invitations[1]!.token) })])
    expect(results.filter((result) => !result.error)).toHaveLength(1)
    const members = await f.service.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "active")
    expect(members.count).toBe(2)
  })

  it("keeps effective entitlement precedence consistent across override, schedule, grace, pause, and cancel", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = f.workspaces[0]!
    await f.service.from("workspace_subscriptions").update({ plan_key: f.planKey, status: "active", scheduled_plan_key: null, scheduled_plan_at: null, payment_grace_ends_at: null }).eq("workspace_id", workspaceId)
    const override = await f.service.from("subscription_overrides").insert({ workspace_id: workspaceId, plan_key: "pro", reason: "integration", actor_user_id: f.users[0]!.id }).select("id").single()
    expect(override.error).toBeNull()
    expect((await ownerClient.rpc("get_effective_entitlements", { target_workspace: workspaceId })).data?.planKey).toBe("pro")
    await f.service.from("subscription_overrides").update({ revoked_at: new Date().toISOString() }).eq("id", override.data!.id)
    await f.service.from("workspace_subscriptions").update({ scheduled_plan_key: "pro", scheduled_plan_at: new Date(Date.now() - 1000).toISOString() }).eq("workspace_id", workspaceId)
    expect((await ownerClient.rpc("get_effective_entitlements", { target_workspace: workspaceId })).data?.planKey).toBe("pro")
    await f.service.from("workspace_subscriptions").update({ status: "past_due", payment_grace_ends_at: new Date(Date.now() + 86400000).toISOString() }).eq("workspace_id", workspaceId)
    expect((await ownerClient.rpc("get_effective_entitlements", { target_workspace: workspaceId })).data?.planKey).toBe("pro")
    await f.service.from("workspace_subscriptions").update({ scheduled_plan_key: null, scheduled_plan_at: null, payment_grace_ends_at: new Date(Date.now() - 1000).toISOString() }).eq("workspace_id", workspaceId)
    expect((await ownerClient.rpc("get_effective_entitlements", { target_workspace: workspaceId })).data?.planKey).toBe("free")
    await f.service.from("workspace_subscriptions").update({ status: "paused", plan_key: f.planKey, scheduled_plan_key: null, scheduled_plan_at: null }).eq("workspace_id", workspaceId)
    expect((await ownerClient.rpc("get_effective_entitlements", { target_workspace: workspaceId })).data?.planKey).toBe("free")
    await f.service.from("workspace_subscriptions").update({ status: "active", plan_key: f.planKey }).eq("workspace_id", workspaceId)
  })

  it("enforces usage limits and unlimited metrics", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = f.workspaces[0]!
    await f.service.from("workspace_usage_periods").delete().eq("workspace_id", workspaceId).eq("metric", "quota-test")
    await f.service.from("plans").update({ limits: { users: 10, "quota-test": 2, api_calls: 10 } }).eq("key", f.planKey)
    await f.service.from("workspace_subscriptions").update({ plan_key: f.planKey, status: "active" }).eq("workspace_id", workspaceId)
    expect((await ownerClient.rpc("consume_usage", { target_workspace: workspaceId, target_metric: "quota-test", increment_by: 2 })).error).toBeNull()
    await rpcError(ownerClient, "consume_usage", { target_workspace: workspaceId, target_metric: "quota-test", increment_by: 1 })
    await f.service.from("plans").update({ limits: { users: 10, "quota-test": null, api_calls: 10 } }).eq("key", f.planKey)
    const unlimited = await ownerClient.rpc("consume_usage", { target_workspace: workspaceId, target_metric: "quota-test", increment_by: 1 })
    expect(unlimited.error).toBeNull()
    expect(unlimited.data?.[0]?.remaining).toBeNull()
    await f.service.from("plans").update({ limits: { users: 10, "quota-test": 2, api_calls: 10 } }).eq("key", f.planKey)
  })

  it("allows platform support inspection, audits it, and blocks direct mutation", async () => {
    const f = requireFixture()
    await f.service.from("platform_members").upsert({ user_id: f.users[6]!.id, role: "support", status: "active" })
    const support = await signedInUser(f.users[6]!)
    const workspaceId = f.workspaces[0]!
    expect((await support.rpc("platform_list_workspaces")).error).toBeNull()
    expect((await support.rpc("platform_support_view", { target_workspace: workspaceId })).error).toBeNull()
    expect((await support.rpc("platform_workspace_360", { target_workspace: workspaceId })).error).toBeNull()
    expect((await support.rpc("platform_health_snapshot")).error).toBeNull()
    const mutation = await support.from("workspaces").update({ name: "Support mutation" }).eq("id", workspaceId)
    expect(mutation.error).toBeNull()
    const unchanged = await f.service.from("workspaces").select("name").eq("id", workspaceId).single()
    expect(unchanged.data?.name).not.toBe("Support mutation")
    const nonPlatform = await signedInUser(f.users[1]!)
    await rpcError(nonPlatform, "platform_list_workspaces", {})
    const audit = await f.service.from("audit_events").select("action").eq("action", "platform.support.view").eq("entity_id", workspaceId)
    expect(audit.error).toBeNull()
    expect(audit.data?.length ?? 0).toBeGreaterThan(0)
  })

  it("enforces the canonical platform capability matrix", async () => {
    const f = requireFixture()
    const roles = ["platform_owner", "platform_admin", "billing_admin", "support", "auditor"] as const
    const roleUsers = f.users.slice(0, roles.length)
    await f.service.from("platform_members").upsert(roleUsers.map((user, index) => ({ user_id: user.id, role: roles[index], status: "active" })))
    const clients = await Promise.all(roleUsers.map((user) => signedInUser(user)))
    const owner = clients[0]!
    const admin = clients[1]!
    const billing = clients[2]!
    const support = clients[3]!
    const auditor = clients[4]!
    expect((await owner.rpc("platform_list_users")).error).toBeNull()
    expect((await admin.rpc("platform_list_domains")).error).toBeNull()
    expect((await billing.rpc("platform_list_subscriptions")).error).toBeNull()
    expect((await billing.rpc("platform_list_overrides")).error).toBeNull()
    await rpcError(billing, "platform_list_workspaces", {})
    await rpcError(billing, "platform_list_users", {})
    await rpcError(billing, "platform_list_domains", {})
    await rpcError(billing, "platform_list_audit", {})
    expect((await support.rpc("platform_list_users")).error).toBeNull()
    expect((await support.rpc("platform_list_domains")).error).toBeNull()
    await rpcError(support, "platform_list_subscriptions", {})
    await rpcError(support, "platform_create_override", { target_workspace: f.workspaces[0], target_plan_key: f.planKey, target_reason: "not allowed" })
    expect((await auditor.rpc("platform_list_audit")).error).toBeNull()
    expect((await auditor.rpc("platform_health_snapshot")).error).toBeNull()
    await rpcError(auditor, "platform_list_users", {})
    await rpcError(auditor, "platform_list_subscriptions", {})
    await rpcError(auditor, "platform_create_override", { target_workspace: f.workspaces[0], target_plan_key: f.planKey, target_reason: "not allowed" })
    const ordinary = await signedInUser(f.users[5]!)
    await rpcError(ordinary, "platform_list_workspaces", {})
    await f.service.from("platform_members").delete().in("user_id", roleUsers.map((user) => user.id))
  })

  it("audits platform mutations and enforces billing/domain operation boundaries", async () => {
    const f = requireFixture()
    await f.service.from("platform_members").upsert([
      { user_id: f.users[0]!.id, role: "platform_owner", status: "active" },
      { user_id: f.users[2]!.id, role: "billing_admin", status: "active" },
      { user_id: f.users[3]!.id, role: "support", status: "active" },
    ])
    const owner = await signedInUser(f.users[0]!)
    const billing = await signedInUser(f.users[2]!)
    const support = await signedInUser(f.users[3]!)
    const operationId = `db-override-${Date.now()}`
    const created = await owner.rpc("platform_create_override", { target_workspace: f.workspaces[0], target_plan_key: f.planKey, target_reason: "Authenticated DB test", target_effective_until: new Date(Date.now() + 86400000).toISOString(), target_operation_id: operationId })
    expect(created.error).toBeNull()
    const override = (Array.isArray(created.data) ? created.data[0] : created.data) as { id: string }
    expect((await billing.rpc("platform_list_overrides", { target_state: "active" })).error).toBeNull()
    const revoked = await billing.rpc("platform_revoke_override", { target_override: override.id, target_reason: "DB test cleanup", target_operation_id: `${operationId}-revoke` })
    expect(revoked.error).toBeNull()
    await rpcError(support, "platform_revoke_override", { target_override: override.id, target_reason: "support is read-only" })
    const audit = await f.service.from("audit_events").select("action,reason,metadata").in("action", ["platform.override.created", "platform.override.revoked"]).eq("entity_id", override.id).order("created_at", { ascending: true })
    expect(audit.error).toBeNull()
    const auditRows = (audit.data ?? []) as Array<{ action: string; metadata: Record<string, unknown> }>
    expect(auditRows.map((row) => row.action)).toEqual(["platform.override.created", "platform.override.revoked"])
    expect(auditRows[0]?.metadata).toMatchObject({ operationId })
    const domainWorkspaceId = await createWorkspace(owner, "Platform Domain Boundary")
    const domain = await f.service.from("workspace_domains").insert({ workspace_id: domainWorkspaceId, hostname: `platform-${Date.now()}.example.com` }).select("id").single()
    expect(domain.error).toBeNull()
    const state = await owner.rpc("platform_apply_domain_reconciliation", { target_domain: domain.data!.id, target_provider_domain_id: "mock-provider-id", target_status: "pending", target_verification_state: "pending", target_dns_configured: false, target_ssl_state: "pending", target_last_error: null, target_operation_id: `${operationId}-domain` })
    expect(state.error).toBeNull()
    await rpcError(support, "platform_apply_domain_reconciliation", { target_domain: domain.data!.id, target_status: "pending", target_verification_state: "pending", target_dns_configured: false, target_ssl_state: "pending", target_last_error: null })
    await f.service.from("workspace_domains").delete().eq("id", domain.data!.id)
    await f.service.from("platform_members").delete().in("user_id", [f.users[0]!.id, f.users[2]!.id, f.users[3]!.id])
  })

  it("scopes search and attention results to the operator role", async () => {
    const f = requireFixture()
    await f.service.from("platform_members").upsert([
      { user_id: f.users[0]!.id, role: "platform_owner", status: "active" },
      { user_id: f.users[2]!.id, role: "billing_admin", status: "active" },
      { user_id: f.users[3]!.id, role: "support", status: "active" },
    ])
    const owner = await signedInUser(f.users[0]!)
    const billing = await signedInUser(f.users[2]!)
    const support = await signedInUser(f.users[3]!)
    const domainWorkspaceId = await createWorkspace(owner, "Platform Attention Boundary")
    const providerUpdate = await f.service.from("workspace_subscriptions").update({ provider: "paddle", provider_customer_id: "cus-role-matrix", provider_subscription_id: "sub-role-matrix", status: "past_due", payment_grace_ends_at: new Date(Date.now() + 86400000).toISOString() }).eq("workspace_id", f.workspaces[0])
    expect(providerUpdate.error).toBeNull()
    const domain = await f.service.from("workspace_domains").insert({ workspace_id: domainWorkspaceId, hostname: `attention-${Date.now()}.example.com`, status: "error", verification_state: "failed" }).select("id").single()
    expect(domain.error).toBeNull()
    const billingSearch = await billing.rpc("platform_search", { target_query: "cus-role-matrix", target_limit: 10 })
    expect(billingSearch.error).toBeNull()
    const billingSearchRows = (billingSearch.data ?? []) as Array<{ result_type: string }>
    expect(billingSearchRows.every((row) => row.result_type === "billing")).toBe(true)
    const billingAttention = await billing.rpc("platform_attention", { target_limit: 20 })
    expect(billingAttention.error).toBeNull()
    const billingAttentionRows = (billingAttention.data ?? []) as Array<{ issue_type: string }>
    expect(billingAttentionRows.every((row) => ["payment", "billing_webhook", "override"].includes(row.issue_type))).toBe(true)
    const supportAttention = await support.rpc("platform_attention", { target_limit: 20 })
    expect(supportAttention.error).toBeNull()
    const supportAttentionRows = (supportAttention.data ?? []) as Array<{ issue_type: string }>
    expect(supportAttentionRows.some((row) => row.issue_type === "domain")).toBe(true)
    const ownerSearch = await owner.rpc("platform_search", { target_query: "attention-", target_limit: 10 })
    expect(ownerSearch.error).toBeNull()
    const ownerSearchRows = (ownerSearch.data ?? []) as Array<{ result_type: string }>
    expect(ownerSearchRows.some((row) => row.result_type === "domain")).toBe(true)
    await f.service.from("workspace_domains").delete().eq("id", domain.data!.id)
    await f.service.from("workspace_subscriptions").update({ provider: null, provider_customer_id: null, provider_subscription_id: null, status: "active", payment_grace_ends_at: null }).eq("workspace_id", f.workspaces[0])
    await f.service.from("platform_members").delete().in("user_id", [f.users[0]!.id, f.users[2]!.id, f.users[3]!.id])
  })

  it("keeps concurrent usage increments at the configured limit", async () => {
    const f = requireFixture()
    const ownerClient = await signedInUser(f.users[0]!)
    const workspaceId = f.workspaces[0]!
    await f.service.from("workspace_subscriptions").update({ plan_key: f.planKey, status: "active" }).eq("workspace_id", workspaceId)
    await f.service.from("workspace_usage_periods").delete().eq("workspace_id", workspaceId).eq("metric", "api_calls")
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => ownerClient.rpc("consume_usage", { target_workspace: workspaceId, target_metric: "api_calls", increment_by: 1 })))
    const successful = results.filter((result) => result.status === "fulfilled" && !result.value.error).length
    const usage = await f.service.from("workspace_usage_periods").select("amount").eq("workspace_id", workspaceId).eq("metric", "api_calls").maybeSingle()
    expect(usage.error).toBeNull()
    expect(usage.data?.amount ?? 0).toBeLessThanOrEqual(10)
    expect(successful).toBe(10)
  })
})

if (!enabled) console.info("[database.integration] skipped: set SAAS_CORE_DB_INTEGRATION=1 after supabase db reset")
