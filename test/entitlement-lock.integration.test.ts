import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const integration = url && anonKey && serviceRoleKey ? describe : describe.skip

integration("transactional entitlement lock", () => {
  const service = url && serviceRoleKey ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  let owner: { id: string; email: string }
  let ownerClient: SupabaseClient
  let workspaceId = ""
  let fixturePriceId = ""

  const plans = [
    { key: "fixture_free", name: "Fixture Free", sort_order: 100, active: true, features: { projects: true }, limits: { "core.workspaces": 1, "core.members": 1, projects: 2 }, metadata: { fixture: true } },
    { key: "fixture_starter", name: "Fixture Starter", sort_order: 50, active: true, features: { projects: true }, limits: { "core.workspaces": 1, "core.members": 1, projects: 1 }, metadata: { fixture: true } },
    { key: "fixture_unlimited", name: "Fixture Unlimited", sort_order: 0, active: true, features: { projects: true }, limits: { "core.workspaces": null, "core.members": null, projects: null }, metadata: { fixture: true } },
  ]

  async function sync(defaultPlanKey: string) {
    return service!.rpc("sync_core_catalog", {
      target_plans: plans,
      target_default_plan_key: defaultPlanKey,
      target_deactivate_missing: false,
    })
  }

  async function restoreCatalog() {
    return service!.rpc("sync_core_catalog", {
      target_plans: [{ key: "core-test", name: "Core test", sort_order: 10, active: true, features: { team: true, domains: true, pwa: true, push: true }, limits: { "core.workspaces": 2, "core.members": 10, projects: 100 }, metadata: { fixture: true } }],
      target_default_plan_key: "core-test",
      target_deactivate_missing: false,
    })
  }

  async function lock(capability: string) {
    const result = await service!.rpc("lock_workspace_entitlement", {
      target_workspace_id: workspaceId,
      target_capability: capability,
    })
    if (result.error) throw result.error
    return result.data?.[0]
  }

  beforeAll(async () => {
    const stamp = Date.now()
    owner = { id: "", email: `entitlement-lock-${stamp}@example.test` }
    const created = await service!.auth.admin.createUser({ email: owner.email, password: "EntitlementLock!2026-password", email_confirm: true })
    if (created.error || !created.data.user) throw created.error || new Error("Could not create entitlement-lock test account.")
    owner.id = created.data.user.id
    ownerClient = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const session = await ownerClient.auth.signInWithPassword({ email: owner.email, password: "EntitlementLock!2026-password" })
    if (session.error) throw session.error
    const configured = await sync("fixture_free")
    if (configured.error) throw configured.error
    fixturePriceId = `pri_entitlement_lock_${stamp}`
    const mapping = await service!.from("billing_provider_prices").upsert({
      provider: "paddle",
      environment: "sandbox",
      plan_key: "fixture_unlimited",
      provider_product_id: `prod_entitlement_lock_${stamp}`,
      provider_price_id: fixturePriceId,
      billing_interval: "month",
      currency: "USD",
      active: true,
    }, { onConflict: "provider,environment,provider_price_id" })
    if (mapping.error) throw mapping.error
    const bootstrap = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Entitlement Lock ${stamp}`, target_workspace_slug: `entitlement-lock-${stamp}` })
    if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Entitlement-lock workspace bootstrap failed.")
    workspaceId = bootstrap.data[0].workspace_id
  })

  afterAll(async () => {
    if (workspaceId) await service!.from("workspaces").delete().eq("id", workspaceId)
    if (fixturePriceId) await service!.from("billing_provider_prices").delete().eq("provider_price_id", fixturePriceId)
    await restoreCatalog()
    if (owner?.id) await service!.auth.admin.deleteUser(owner.id)
  })

  it("resolves finite, unknown, canceled, and unlimited capability state", async () => {
    const configuredFallback = await service!.rpc("get_core_default_plan_key")
    expect(configuredFallback.error).toBeNull()
    const fallbackValue = Array.isArray(configuredFallback.data) ? configuredFallback.data[0] : configuredFallback.data
    const fallbackKey = typeof fallbackValue === "string" ? fallbackValue : (fallbackValue as { get_core_default_plan_key?: string; core_default_plan_key?: string } | null)?.get_core_default_plan_key || (fallbackValue as { core_default_plan_key?: string } | null)?.core_default_plan_key
    expect(fallbackKey).toBe("fixture_free")
    await expect(lock("projects")).resolves.toMatchObject({
      plan_key: "fixture_free",
      capability_configured: true,
      feature_enabled: true,
      limit_value: 2,
      unlimited: false,
    })
    await expect(lock("not_configured")).resolves.toMatchObject({
      plan_key: "fixture_free",
      capability_configured: false,
      feature_enabled: false,
      limit_value: null,
      unlimited: false,
    })

    const canceled = await service!.from("workspace_subscriptions").update({ status: "canceled" }).eq("workspace_id", workspaceId)
    expect(canceled.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const override = await service!.from("subscription_overrides").insert({ workspace_id: workspaceId, plan_key: "fixture_unlimited", reason: "Entitlement lock fixture", created_by: owner.id }).select("id").single()
    expect(override.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_unlimited", unlimited: true })
    if (override.data?.id) await service!.from("subscription_overrides").delete().eq("id", override.data.id)

    const missingProviderSubscription = await service!.from("workspace_subscriptions").update({ status: "active", plan_key: "fixture_unlimited", source: "paddle", provider: "paddle", provider_environment: "sandbox", provider_customer_id: "cus_fixture", provider_subscription_id: null, provider_price_id: fixturePriceId }).eq("workspace_id", workspaceId)
    expect(missingProviderSubscription.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const unlimited = await service!.from("workspace_subscriptions").update({ status: "active", plan_key: "fixture_unlimited", source: "paddle", provider: "paddle", provider_environment: "sandbox", provider_customer_id: "cus_fixture", provider_subscription_id: "sub_fixture", provider_price_id: fixturePriceId }).eq("workspace_id", workspaceId)
    expect(unlimited.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_unlimited", capability_configured: true, limit_value: null, unlimited: true })

    const expired = await service!.from("workspace_subscriptions").update({ current_period_start: "2026-08-01", current_period_end: "2026-09-01", current_period_end_at: "2026-09-01T00:00:00.000Z" }).eq("workspace_id", workspaceId)
    expect(expired.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const renewed = await service!.from("workspace_subscriptions").update({ current_period_end: future.toISOString().slice(0, 10), current_period_end_at: future.toISOString(), cancel_at_period_end: false, scheduled_change_action: null, scheduled_change_at: null }).eq("workspace_id", workspaceId)
    expect(renewed.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_unlimited", unlimited: true })

    const scheduledDowngrade = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_free",
      status: "active",
      source: "system",
      provider: null,
      provider_environment: null,
      provider_customer_id: null,
      provider_subscription_id: null,
      provider_price_id: null,
      cancel_at_period_end: false,
      scheduled_change_action: null,
      scheduled_change_at: null,
      scheduled_plan_key: "fixture_starter",
      scheduled_plan_at: future.toISOString().slice(0, 10),
      scheduled_effective_at: future.toISOString(),
    }).eq("workspace_id", workspaceId)
    expect(scheduledDowngrade.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({
      plan_key: "fixture_free",
      capability_configured: true,
      feature_enabled: true,
      limit_value: 1,
      unlimited: false,
    })

    const restoredUnlimited = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_unlimited",
      source: "paddle",
      provider: "paddle",
      provider_environment: "sandbox",
      provider_customer_id: "cus_fixture",
      provider_subscription_id: "sub_fixture",
      provider_price_id: fixturePriceId,
      scheduled_plan_key: null,
      scheduled_plan_at: null,
      scheduled_effective_at: null,
    }).eq("workspace_id", workspaceId)
    expect(restoredUnlimited.error).toBeNull()

    const scheduledCancel = await service!.from("workspace_subscriptions").update({ cancel_at_period_end: true, scheduled_change_action: "cancel", scheduled_change_at: future.toISOString(), current_period_end: future.toISOString().slice(0, 10), current_period_end_at: future.toISOString() }).eq("workspace_id", workspaceId)
    expect(scheduledCancel.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_unlimited" })

    const endedCancel = await service!.from("workspace_subscriptions").update({ scheduled_change_at: new Date(Date.now() - 1000).toISOString(), current_period_end: new Date(Date.now() - 1000).toISOString().slice(0, 10), current_period_end_at: new Date(Date.now() - 1000).toISOString() }).eq("workspace_id", workspaceId)
    expect(endedCancel.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })
  })

  it("falls back when the local subscription row is missing and stays server-only", async () => {
    const removed = await service!.from("workspace_subscriptions").delete().eq("workspace_id", workspaceId)
    expect(removed.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2, unlimited: false })

    const clientCall = await ownerClient.rpc("lock_workspace_entitlement", { target_workspace_id: workspaceId, target_capability: "projects" })
    expect(clientCall.error).not.toBeNull()
  })

  it("guards Core membership writes and rejects a finite member quota", async () => {
    const unlimitedSubscription = await service!.from("workspace_subscriptions").upsert({
      workspace_id: workspaceId,
      plan_key: "fixture_unlimited",
      status: "active",
      source: "paddle",
      provider: "paddle",
      provider_environment: "sandbox",
      provider_customer_id: "cus_fixture",
      provider_subscription_id: "sub_fixture",
      provider_price_id: fixturePriceId,
    })
    expect(unlimitedSubscription.error).toBeNull()
    const tokenHash = `renewal-token-${Date.now()}`
    const invitation = await ownerClient.rpc("create_workspace_invitation", {
      target_workspace_id: workspaceId,
      target_email: `over-limit-${Date.now()}@example.test`,
      target_role: "staff",
      target_token_hash: tokenHash,
    })
    expect(invitation.error).toBeNull()
    const invitationId = invitation.data?.[0]?.invitation_id
    expect(invitationId).toBeTruthy()

    const expired = await service!.from("workspace_invitations").update({ expires_at: new Date(Date.now() - 60_000).toISOString(), last_sent_at: new Date(Date.now() - 120_000).toISOString() }).eq("id", invitationId)
    expect(expired.error).toBeNull()
    const finiteSubscription = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_free",
      source: "system",
      provider: null,
      provider_environment: null,
      provider_customer_id: null,
      provider_subscription_id: null,
      provider_price_id: null,
    }).eq("workspace_id", workspaceId)
    expect(finiteSubscription.error).toBeNull()
    const renewal = await ownerClient.rpc("renew_workspace_invitation", { target_invitation_id: invitationId, target_token_hash: `renewed-token-${Date.now()}` })
    expect(renewal.error?.message).toContain("USER_LIMIT_REACHED")

    const invitationRemoved = await service!.from("workspace_invitations").delete().eq("id", invitationId)
    expect(invitationRemoved.error).toBeNull()

    const directDelete = await ownerClient.from("workspace_members").delete().eq("id", "00000000-0000-4000-8000-000000000099")
    expect(directDelete.error).not.toBeNull()
  })

  it("renews only eligible invitations and returns qualified renewal data", async () => {
    const unlimitedSubscription = await service!.from("workspace_subscriptions").upsert({
      workspace_id: workspaceId,
      plan_key: "fixture_unlimited",
      status: "active",
      source: "paddle",
      provider: "paddle",
      provider_environment: "sandbox",
      provider_customer_id: "cus_fixture",
      provider_subscription_id: "sub_fixture",
      provider_price_id: fixturePriceId,
    })
    expect(unlimitedSubscription.error).toBeNull()

    const invitationIds: string[] = []
    const createRenewableInvitation = async (email: string) => {
      const created = await ownerClient.rpc("create_workspace_invitation", {
        target_workspace_id: workspaceId,
        target_email: email,
        target_role: "staff",
        target_token_hash: `initial-${Date.now()}-${email}`,
      })
      expect(created.error).toBeNull()
      const invitationId = created.data?.[0]?.invitation_id
      expect(invitationId).toBeTruthy()
      invitationIds.push(invitationId)
      const old = new Date(Date.now() - 120_000).toISOString()
      const expired = await service!.from("workspace_invitations").update({ expires_at: new Date(Date.now() - 60_000).toISOString(), last_sent_at: old }).eq("id", invitationId)
      expect(expired.error).toBeNull()
      return invitationId
    }

    try {
      const eligibleId = await createRenewableInvitation(`renewable-${Date.now()}@example.test`)
      const nextToken = `renewed-${Date.now()}`
      const renewed = await ownerClient.rpc("renew_workspace_invitation", { target_invitation_id: eligibleId, target_token_hash: nextToken })
      expect(renewed.error).toBeNull()
      expect(renewed.data?.[0]).toMatchObject({ invitation_id: eligibleId, role: "staff" })
      const renewedRow = await service!.from("workspace_invitations").select("email, token_hash, expires_at, last_sent_at, email_delivery_status, delivery_error").eq("id", eligibleId).single()
      expect(renewedRow.error).toBeNull()
      expect(renewedRow.data).toMatchObject({ token_hash: nextToken, email_delivery_status: "pending", delivery_error: null })
      expect(new Date(renewedRow.data?.expires_at).getTime()).toBeGreaterThan(Date.now())
      const cooldown = await ownerClient.rpc("renew_workspace_invitation", { target_invitation_id: eligibleId, target_token_hash: `${nextToken}-again` })
      expect(cooldown.error?.message).toContain("INVITATION_RESEND_COOLDOWN")

      const acceptedId = await createRenewableInvitation(`accepted-${Date.now()}@example.test`)
      const accepted = await service!.from("workspace_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", acceptedId)
      expect(accepted.error).toBeNull()
      const acceptedRenewal = await ownerClient.rpc("renew_workspace_invitation", { target_invitation_id: acceptedId, target_token_hash: `accepted-renewed-${Date.now()}` })
      expect(acceptedRenewal.error?.message).toContain("INVITATION_NOT_PENDING")

      const revokedId = await createRenewableInvitation(`revoked-${Date.now()}@example.test`)
      const revoked = await service!.from("workspace_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", revokedId)
      expect(revoked.error).toBeNull()
      const revokedRenewal = await ownerClient.rpc("renew_workspace_invitation", { target_invitation_id: revokedId, target_token_hash: `revoked-renewed-${Date.now()}` })
      expect(revokedRenewal.error?.message).toContain("INVITATION_NOT_PENDING")

      const unauthorizedId = await createRenewableInvitation(`unauthorized-${Date.now()}@example.test`)
      const outsiderEmail = `renewal-outsider-${Date.now()}@example.test`
      const outsider = await service!.auth.admin.createUser({ email: outsiderEmail, password: "RenewalOutsider!2026-password", email_confirm: true })
      expect(outsider.error || !outsider.data.user).toBeFalsy()
      const outsiderClient = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
      const outsiderSession = await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password: "RenewalOutsider!2026-password" })
      expect(outsiderSession.error).toBeNull()
      const unauthorized = await outsiderClient.rpc("renew_workspace_invitation", { target_invitation_id: unauthorizedId, target_token_hash: `unauthorized-renewed-${Date.now()}` })
      expect(unauthorized.error?.message).toContain("FORBIDDEN")
      if (outsider.data.user) await service!.auth.admin.deleteUser(outsider.data.user.id)
    } finally {
      if (invitationIds.length) await service!.from("workspace_invitations").delete().in("id", invitationIds)
    }
  })
})
