import { execFileSync } from "node:child_process"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { getWorkspaceEntitlements, resolveEffectiveEntitlementPlan } from "@/lib/entitlements"

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
  let currentPlanPriceId = ""
  let targetPlanPriceId = ""
  let thirdPriceId = ""
  const paidPeriod = {
    current_period_start_at: new Date(Date.now() - 60_000).toISOString(),
    current_period_end_at: new Date(Date.now() + 86_400_000).toISOString(),
  }

  const plans = [
    { key: "fixture_free", name: "Fixture Free", sort_order: 100, active: true, features: { projects: true }, limits: { "core.workspaces": 1, "core.members": 1, projects: 2 }, metadata: { fixture: true } },
    { key: "fixture_starter", name: "Fixture Starter", sort_order: 50, active: true, features: { projects: true }, limits: { "core.workspaces": 1, "core.members": 1, projects: 1 }, metadata: { fixture: true } },
    { key: "fixture_pro", name: "Fixture Pro", sort_order: 75, active: true, features: { projects: true }, limits: { "core.workspaces": 1, "core.members": 1, projects: 3, extra: 4 }, metadata: { fixture: true } },
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
    currentPlanPriceId = `pri_entitlement_lock_pro_${stamp}`
    targetPlanPriceId = `pri_entitlement_lock_starter_${stamp}`
    thirdPriceId = `pri_entitlement_lock_third_${stamp}`
    const mapping = await service!.from("billing_provider_prices").upsert([
      { provider: "stripe", environment: "sandbox", plan_key: "fixture_unlimited", provider_product_id: `prod_entitlement_lock_${stamp}`, provider_price_id: fixturePriceId, billing_interval: "month", currency: "USD", active: true },
      { provider: "stripe", environment: "sandbox", plan_key: "fixture_pro", provider_product_id: `prod_entitlement_lock_${stamp}`, provider_price_id: currentPlanPriceId, billing_interval: "month", currency: "USD", active: true },
      { provider: "stripe", environment: "sandbox", plan_key: "fixture_starter", provider_product_id: `prod_entitlement_lock_${stamp}`, provider_price_id: targetPlanPriceId, billing_interval: "month", currency: "USD", active: true },
    ], { onConflict: "provider,environment,provider_price_id" })
    if (mapping.error) throw mapping.error
    const bootstrap = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Entitlement Lock ${stamp}`, target_workspace_slug: `entitlement-lock-${stamp}` })
    if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Entitlement-lock workspace bootstrap failed.")
    workspaceId = bootstrap.data[0].workspace_id
  })

  afterAll(async () => {
    if (workspaceId) await service!.from("workspaces").delete().eq("id", workspaceId)
    const fixturePrices = [fixturePriceId, currentPlanPriceId, targetPlanPriceId, thirdPriceId].filter(Boolean)
    if (fixturePrices.length) await service!.from("billing_provider_prices").delete().in("provider_price_id", fixturePrices)
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

    const trialStartedAt = new Date(Date.now() - 60_000)
    const trialEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const activeTrial = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_pro",
      status: "trialing",
      source: "trial",
      provider: null,
      provider_environment: null,
      provider_customer_id: null,
      provider_subscription_id: null,
      provider_price_id: null,
      current_period_start_at: trialStartedAt.toISOString(),
      current_period_end_at: trialEndsAt.toISOString(),
      current_period_end: trialEndsAt.toISOString().slice(0, 10),
      initial_trial_started_at: trialStartedAt.toISOString(),
      initial_trial_ends_at: trialEndsAt.toISOString(),
    }).eq("workspace_id", workspaceId)
    expect(activeTrial.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({
      plan_key: "fixture_pro",
      capability_configured: true,
      limit_value: 3,
      unlimited: false,
    })

    const converted = await service!.from("workspace_subscriptions").update({
      status: "active", source: "provider", provider: "stripe", provider_environment: "sandbox",
      provider_customer_id: "cus_fixture", provider_subscription_id: "sub_fixture", provider_price_id: currentPlanPriceId,
      ...paidPeriod,
    }).eq("workspace_id", workspaceId)
    expect(converted.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_pro", limit_value: 3 })

    const canceledTrial = await service!.from("workspace_subscriptions").update({
      status: "canceled", source: "trial", provider: null, provider_environment: null,
      provider_customer_id: null, provider_subscription_id: null, provider_price_id: null,
    }).eq("workspace_id", workspaceId)
    expect(canceledTrial.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const expiredAt = new Date(Date.now() - 1_000)
    const expiredTrial = await service!.from("workspace_subscriptions").update({
      status: "trialing",
      current_period_end_at: expiredAt.toISOString(),
      current_period_end: expiredAt.toISOString().slice(0, 10),
      initial_trial_ends_at: expiredAt.toISOString(),
    }).eq("workspace_id", workspaceId)
    expect(expiredTrial.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({
      plan_key: "fixture_free",
      capability_configured: true,
      limit_value: 2,
      unlimited: false,
    })

    const resetAfterTrial = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_free",
      status: "active",
      source: "system",
      current_period_start: null,
      current_period_start_at: null,
      current_period_end_at: null,
      current_period_end: null,
      initial_trial_started_at: null,
      initial_trial_ends_at: null,
    }).eq("workspace_id", workspaceId)
    expect(resetAfterTrial.error).toBeNull()

    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const override = await service!.from("subscription_overrides").insert({ workspace_id: workspaceId, plan_key: "fixture_unlimited", reason: "Entitlement lock fixture", created_by: owner.id }).select("id").single()
    expect(override.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_unlimited", unlimited: true })
    if (override.data?.id) await service!.from("subscription_overrides").delete().eq("id", override.data.id)

    const missingProviderSubscription = await service!.from("workspace_subscriptions").update({ status: "active", plan_key: "fixture_unlimited", source: "provider", provider: "stripe", provider_environment: "sandbox", provider_customer_id: "cus_fixture", provider_subscription_id: null, provider_price_id: fixturePriceId }).eq("workspace_id", workspaceId)
    expect(missingProviderSubscription.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const missingProviderPeriod = await service!.from("workspace_subscriptions").update({ status: "active", plan_key: "fixture_unlimited", source: "provider", provider: "stripe", provider_environment: "sandbox", provider_customer_id: "cus_fixture", provider_subscription_id: "sub_fixture", provider_price_id: fixturePriceId }).eq("workspace_id", workspaceId)
    expect(missingProviderPeriod.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const unlimited = await service!.from("workspace_subscriptions").update(paidPeriod).eq("workspace_id", workspaceId)
    expect(unlimited.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_unlimited", capability_configured: true, limit_value: null, unlimited: true })

    const canceled = await service!.from("workspace_subscriptions").update({ status: "canceled" }).eq("workspace_id", workspaceId)
    expect(canceled.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const expiredStart = new Date(Date.now() - 2 * 86_400_000)
    const expiredEnd = new Date(Date.now() - 86_400_000)
    const expired = await service!.from("workspace_subscriptions").update({ status: "active", current_period_start_at: expiredStart.toISOString(), current_period_start: expiredStart.toISOString().slice(0, 10), current_period_end: expiredEnd.toISOString().slice(0, 10), current_period_end_at: expiredEnd.toISOString() }).eq("workspace_id", workspaceId)
    expect(expired.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const renewed = await service!.from("workspace_subscriptions").update({ current_period_end: future.toISOString().slice(0, 10), current_period_end_at: future.toISOString(), cancel_at_period_end: false, scheduled_change_action: null, scheduled_change_at: null }).eq("workspace_id", workspaceId)
    expect(renewed.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_unlimited", unlimited: true })

    const futureSchedule = { scheduled_plan_key: "fixture_starter", scheduled_plan_at: future.toISOString().slice(0, 10), scheduled_effective_at: future.toISOString(), scheduled_provider_price_id: targetPlanPriceId, scheduled_change_action: null, cancel_at_period_end: false, current_period_end: future.toISOString().slice(0, 10), current_period_end_at: future.toISOString() }
    const currentPriceFuture = await service!.from("workspace_subscriptions").update({ plan_key: "fixture_pro", source: "provider", provider: "stripe", provider_environment: "sandbox", provider_customer_id: "cus_fixture", provider_subscription_id: "sub_fixture", provider_price_id: currentPlanPriceId, ...futureSchedule }).eq("workspace_id", workspaceId)
    expect(currentPriceFuture.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_pro", limit_value: 3, unlimited: false })

    const targetPriceFuture = await service!.from("workspace_subscriptions").update({ provider_price_id: targetPlanPriceId, ...futureSchedule }).eq("workspace_id", workspaceId)
    expect(targetPriceFuture.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_pro", limit_value: 3, unlimited: false })

    const thirdPriceFuture = await service!.from("workspace_subscriptions").update({ provider_price_id: thirdPriceId, ...futureSchedule }).eq("workspace_id", workspaceId)
    expect(thirdPriceFuture.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2, unlimited: false })

    const missingTargetMapping = await service!.from("workspace_subscriptions").update({ ...futureSchedule, provider_price_id: currentPlanPriceId, scheduled_provider_price_id: `pri_missing_target_${Date.now()}` }).eq("workspace_id", workspaceId)
    expect(missingTargetMapping.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2, unlimited: false })

    const inactiveTarget = await service!.from("plans").update({ active: false }).eq("key", "fixture_unlimited")
    expect(inactiveTarget.error).toBeNull()
    const inactiveTargetSchedule = await service!.from("workspace_subscriptions").update({ ...futureSchedule, scheduled_plan_key: "fixture_unlimited", provider_price_id: currentPlanPriceId, scheduled_provider_price_id: fixturePriceId }).eq("workspace_id", workspaceId)
    expect(inactiveTargetSchedule.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2, unlimited: false })
    const activeTarget = await service!.from("plans").update({ active: true }).eq("key", "fixture_unlimited")
    expect(activeTarget.error).toBeNull()

    const scheduledPriceUpgrade = await service!.from("workspace_subscriptions").update({ plan_key: "fixture_starter", provider_price_id: targetPlanPriceId, scheduled_plan_key: "fixture_pro", scheduled_provider_price_id: currentPlanPriceId, scheduled_plan_at: future.toISOString().slice(0, 10), scheduled_effective_at: future.toISOString(), scheduled_change_action: null }).eq("workspace_id", workspaceId)
    expect(scheduledPriceUpgrade.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_starter", limit_value: 1, unlimited: false })

    const providerScheduledCancel = await service!.from("workspace_subscriptions").update({ plan_key: "fixture_pro", provider_price_id: currentPlanPriceId, scheduled_plan_key: null, scheduled_provider_price_id: null, scheduled_plan_at: null, scheduled_effective_at: null, cancel_at_period_end: true, scheduled_change_action: "cancel", scheduled_change_at: future.toISOString(), current_period_end: future.toISOString().slice(0, 10), current_period_end_at: future.toISOString() }).eq("workspace_id", workspaceId)
    expect(providerScheduledCancel.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_pro", limit_value: 3, unlimited: false })

    const undo = await service!.from("workspace_subscriptions").update({ cancel_at_period_end: false, scheduled_change_action: null, scheduled_change_at: null }).eq("workspace_id", workspaceId)
    expect(undo.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_pro", limit_value: 3, unlimited: false })

    const boundary = await service!.from("workspace_subscriptions").update({ plan_key: "fixture_pro", provider_price_id: currentPlanPriceId, scheduled_plan_key: "fixture_starter", scheduled_provider_price_id: targetPlanPriceId, scheduled_plan_at: new Date(Date.now() - 1000).toISOString().slice(0, 10), scheduled_effective_at: new Date(Date.now() - 1000).toISOString(), scheduled_change_action: null, cancel_at_period_end: false }).eq("workspace_id", workspaceId)
    expect(boundary.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_starter", limit_value: 1, unlimited: false })

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
      scheduled_provider_price_id: null,
    }).eq("workspace_id", workspaceId)
    expect(scheduledDowngrade.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({
      plan_key: "fixture_free",
      capability_configured: true,
      feature_enabled: true,
      limit_value: 2,
      unlimited: false,
    })

    const clearedScheduledTarget = await service!.from("workspace_subscriptions").update({ scheduled_plan_key: null, scheduled_plan_at: null, scheduled_effective_at: null }).eq("workspace_id", workspaceId)
    expect(clearedScheduledTarget.error).toBeNull()
    const deactivatedTarget = await service!.from("plans").update({ active: false }).eq("key", "fixture_starter")
    expect(deactivatedTarget.error).toBeNull()
    const invalidScheduledTarget = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_pro",
      status: "active",
      source: "manual",
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
    expect(invalidScheduledTarget.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({
      plan_key: "fixture_pro",
      capability_configured: false,
      feature_enabled: false,
      limit_value: null,
      unlimited: false,
    })

    const reactivatedTarget = await service!.from("plans").update({ active: true }).eq("key", "fixture_starter")
    expect(reactivatedTarget.error).toBeNull()
    const missingTargetCapability = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_pro",
      source: "manual",
      scheduled_plan_key: "fixture_starter",
      scheduled_plan_at: future.toISOString().slice(0, 10),
      scheduled_effective_at: future.toISOString(),
    }).eq("workspace_id", workspaceId)
    expect(missingTargetCapability.error).toBeNull()
    await expect(lock("extra")).resolves.toMatchObject({
      plan_key: "fixture_pro",
      capability_configured: true,
      feature_enabled: false,
      limit_value: 4,
      unlimited: false,
    })
    const scheduledUpgrade = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_starter",
      source: "manual",
      scheduled_plan_key: "fixture_pro",
      scheduled_plan_at: future.toISOString().slice(0, 10),
      scheduled_effective_at: future.toISOString(),
    }).eq("workspace_id", workspaceId)
    expect(scheduledUpgrade.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_starter", limit_value: 1, unlimited: false })

    const restoredUnlimited = await service!.from("workspace_subscriptions").update({
      plan_key: "fixture_unlimited",
      source: "provider",
      provider: "stripe",
      provider_environment: "sandbox",
      provider_customer_id: "cus_fixture",
      provider_subscription_id: "sub_fixture",
      provider_price_id: fixturePriceId,
      scheduled_plan_key: null,
      scheduled_plan_at: null,
      scheduled_effective_at: null,
    }).eq("workspace_id", workspaceId)
    expect(restoredUnlimited.error).toBeNull()

    const scheduledCancel = await service!.from("workspace_subscriptions").update({ plan_key: "fixture_pro", source: "manual", provider: null, provider_environment: null, provider_customer_id: null, provider_subscription_id: null, provider_price_id: null, cancel_at_period_end: true, scheduled_change_action: "cancel", scheduled_change_at: future.toISOString(), current_period_end: future.toISOString().slice(0, 10), current_period_end_at: future.toISOString() }).eq("workspace_id", workspaceId)
    expect(scheduledCancel.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_pro", limit_value: 3, unlimited: false })

    const endedCancel = await service!.from("workspace_subscriptions").update({ scheduled_change_at: new Date(Date.now() - 1000).toISOString(), current_period_end: new Date(Date.now() - 1000).toISOString().slice(0, 10), current_period_end_at: new Date(Date.now() - 1000).toISOString() }).eq("workspace_id", workspaceId)
    expect(endedCancel.error).toBeNull()
    await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free", limit_value: 2 })
  })

  it("agrees with the application for the same stored lifecycle and price states", async () => {
    const ago = new Date(Date.now() - 60_000).toISOString()
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const date = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
    const reset = {
      plan_key: "fixture_pro", status: "active", source: "provider", provider: "stripe", provider_environment: "sandbox",
      provider_customer_id: "cus_parity", provider_subscription_id: "sub_parity", provider_price_id: currentPlanPriceId,
      current_period_start_at: ago, current_period_end_at: later, current_period_start: null, current_period_end: null,
      initial_trial_started_at: null, initial_trial_ends_at: null, payment_grace_ends_at: null,
      scheduled_plan_key: null, scheduled_plan_at: null, scheduled_effective_at: null,
      scheduled_provider_price_id: null, scheduled_change_action: null, scheduled_change_at: null, cancel_at_period_end: false,
    }
    const trial = {
      status: "trialing", source: "trial", provider: null, provider_environment: null,
      provider_customer_id: null, provider_subscription_id: null, provider_price_id: null,
      initial_trial_started_at: ago, initial_trial_ends_at: later,
    }
    const schedule = { scheduled_plan_key: "fixture_starter", scheduled_effective_at: later, scheduled_provider_price_id: targetPlanPriceId }
    const fixtures: [string, Record<string, unknown>, "fixture_free" | "fixture_pro" | "fixture_starter" | "fixture_unlimited"][] = [
      ["system", { source: "system" }, "fixture_free"],
      ["system cannot schedule paid", { source: "system", ...schedule, scheduled_effective_at: ago }, "fixture_free"],
      ["initial trial", trial, "fixture_pro"],
      ["expired initial trial", { ...trial, initial_trial_ends_at: ago, initial_trial_started_at: new Date(Date.parse(ago) - 60000).toISOString() }, "fixture_free"],
      ["active paid", {}, "fixture_pro"],
      ["missing period end", { current_period_end_at: null }, "fixture_free"],
      ["expired period end", { current_period_start_at: null, current_period_end_at: ago }, "fixture_free"],
      ["future paid start", { current_period_start_at: later, current_period_end_at: new Date(Date.parse(later) + 60000).toISOString() }, "fixture_free"],
      ["legacy date-only period", { current_period_start: date(-1), current_period_end: date(2), current_period_start_at: null, current_period_end_at: null }, "fixture_pro"],
      ["past due within grace", { status: "past_due", payment_grace_ends_at: later }, "fixture_pro"],
      ["past due beyond grace", { status: "past_due", payment_grace_ends_at: ago }, "fixture_free"],
      ["past due beyond paid period despite grace", { status: "past_due", payment_grace_ends_at: later, current_period_start_at: null, current_period_end_at: ago }, "fixture_free"],
      ["pending", { status: "pending" }, "fixture_free"],
      ["unpaid", { status: "unpaid" }, "fixture_free"],
      ["paused", { status: "paused" }, "fixture_free"],
      ["canceled", { status: "canceled" }, "fixture_free"],
      ["downgrade pending", schedule, "fixture_pro"],
      ["downgrade after boundary", { ...schedule, scheduled_effective_at: ago }, "fixture_starter"],
      ["orphan scheduled boundary", { scheduled_effective_at: later }, "fixture_free"],
      ["invalid target price mapping", { ...schedule, scheduled_provider_price_id: thirdPriceId }, "fixture_free"],
      ["incomplete provider identity", { provider_subscription_id: null }, "fixture_free"],
      ["cross environment price", { provider_environment: "live" }, "fixture_free"],
      ["unmapped provider price", { provider_price_id: thirdPriceId }, "fixture_free"],
      ["manual plan without billing", { source: "manual", current_period_end_at: null, provider: null }, "fixture_pro"],
      ["override of canceled provider", { status: "canceled", ...schedule }, "fixture_unlimited"],
      ["resume does not apply a stale scheduled plan", { ...schedule, scheduled_effective_at: ago, scheduled_change_action: "resume" }, "fixture_pro"],
    ]
    for (const [name, changes, plan] of fixtures) {
      const applied = await service!.from("workspace_subscriptions").update({ ...reset, ...changes }).eq("workspace_id", workspaceId)
      expect(applied.error, name).toBeNull()
      const override = plan === "fixture_unlimited"
        ? await service!.from("subscription_overrides").insert({ workspace_id: workspaceId, plan_key: plan, reason: "Parity fixture", created_by: owner.id }).select("id").single()
        : null
      try {
        expect(override?.error ?? null, name).toBeNull()
        const app = await getWorkspaceEntitlements(workspaceId)
        const sql = await lock("projects")
        expect(app.planKey, name).toBe(plan)
        expect(sql, name).toMatchObject({ plan_key: plan, capability_configured: true, feature_enabled: true, limit_value: app.limits.projects, unlimited: app.limits.projects === null })
      } finally {
        if (override?.data) await service!.from("subscription_overrides").delete().eq("id", override.data.id)
      }
    }

    const protectedPlan = await service!.from("plans").update({ active: false }).eq("key", "fixture_pro")
    expect(protectedPlan.error?.message).toBe("PLAN_REFERENCED_ACTIVE")
    const detached = await service!.from("workspace_subscriptions").update({ ...reset, plan_key: "fixture_free", source: "system" }).eq("workspace_id", workspaceId)
    expect(detached.error).toBeNull()
    const inactive = await service!.from("plans").update({ active: false }).eq("key", "fixture_pro")
    expect(inactive.error).toBeNull()
    const malformedProjection = await service!.from("workspace_subscriptions").update(reset).eq("workspace_id", workspaceId)
    expect(malformedProjection.error).toBeNull()
    try {
      await expect(getWorkspaceEntitlements(workspaceId)).resolves.toMatchObject({ planKey: "fixture_free" })
      await expect(lock("projects")).resolves.toMatchObject({ plan_key: "fixture_free" })
    } finally {
      await service!.from("plans").update({ active: true }).eq("key", "fixture_pro")
    }
    const missingId = "00000000-0000-4000-8000-000000000001"
    await expect(getWorkspaceEntitlements(missingId)).rejects.toMatchObject({ code: "PLAN_UNAVAILABLE" })
    const missing = await service!.rpc("lock_workspace_entitlement", { target_workspace_id: missingId, target_capability: "projects" })
    expect(missing.error?.message).toBe("WORKSPACE_UNAVAILABLE")
    const invalid = await service!.rpc("lock_workspace_entitlement", { target_workspace_id: workspaceId, target_capability: "?" })
    expect(invalid.error?.message).toBe("INVALID_ENTITLEMENT_REQUEST")
  })

  it("applies exact transaction boundaries in UTC and New York, including the DST date conversion", () => {
    // The integration runner enforces the Core port; psql targets only the
    // named disposable Core database. All SQL fixture changes roll back.
    if (url !== "http://127.0.0.1:55621") throw new Error("Expected the isolated Core Supabase instance.")
    const results = (zone: string) => execFileSync("docker", [
      "exec", "-i", "supabase_db_saas-core-dev", "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
    ], { encoding: "utf8", input: `
      begin;
      set local timezone to '${zone}';
      update public.workspace_subscriptions set source = 'provider', status = 'active',
        plan_key = 'fixture_pro', provider = 'stripe', provider_environment = 'sandbox',
        provider_customer_id = 'cus_parity', provider_subscription_id = 'sub_parity',
        provider_price_id = '${currentPlanPriceId}', current_period_start_at = now() - interval '1 day',
        current_period_end_at = now() + interval '1 day', cancel_at_period_end = false,
        scheduled_change_action = null, scheduled_plan_key = 'fixture_starter',
        scheduled_provider_price_id = '${targetPlanPriceId}', scheduled_effective_at = now() + interval '1 millisecond'
        where workspace_id = '${workspaceId}';
      select plan_key from public.lock_workspace_entitlement('${workspaceId}', 'projects');
      update public.workspace_subscriptions set scheduled_effective_at = now() where workspace_id = '${workspaceId}';
      select plan_key from public.lock_workspace_entitlement('${workspaceId}', 'projects');
      update public.workspace_subscriptions set current_period_end_at = now() where workspace_id = '${workspaceId}';
      select plan_key from public.lock_workspace_entitlement('${workspaceId}', 'projects');
      select to_char((date '2026-03-08'::timestamp at time zone 'UTC') at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS');
      select to_char((date '2026-03-09'::timestamp at time zone 'UTC') at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS');
      rollback;
    ` }).trim().split("\n")
    const expected = ["fixture_pro", "fixture_starter", "fixture_free", "2026-03-08 00:00:00", "2026-03-09 00:00:00"]
    expect(results("UTC")).toEqual(expected)
    expect(results("America/New_York")).toEqual(expected)
    const resolve = (now: string, end = "2026-03-09") => resolveEffectiveEntitlementPlan({
      subscriptionPlanKey: "fixture_pro", fallbackPlanKey: "fixture_free", status: "active", source: "provider",
      provider: "stripe", providerEnvironment: "sandbox", providerCustomerId: "cus_parity",
      providerSubscriptionId: "sub_parity", providerPriceId: currentPlanPriceId, currentPeriodEndAt: end,
      scheduledPlanKey: "fixture_starter", scheduledPlanAt: "2026-03-08T03:00:00-04:00", now: new Date(now),
    })
    expect(resolve("2026-03-08T01:59:59.999-05:00")).toBe("fixture_pro")
    expect(resolve("2026-03-08T03:00:00-04:00")).toBe("fixture_starter")
    expect(resolve("2026-03-08T20:00:00-04:00")).toBe("fixture_free")
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
      ...paidPeriod,
      plan_key: "fixture_unlimited",
      status: "active",
      source: "provider",
      provider: "stripe",
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
      ...paidPeriod,
      plan_key: "fixture_unlimited",
      status: "active",
      source: "provider",
      provider: "stripe",
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
