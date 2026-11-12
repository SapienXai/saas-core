import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import Stripe from "stripe"
import { hasMatchingPaidStripePeriod } from "../lib/billing/stripe-paid-period.mjs"

const argumentsList = process.argv.slice(2)
const dryRun = argumentsList.includes("--dry-run") || !argumentsList.includes("--apply") || process.env.BILLING_RECONCILE_DRY_RUN === "true"
const workspaceSlug = argumentsList.find((value) => !value.startsWith("--"))
if (!workspaceSlug) {
  console.error("Usage: npm run billing:reconcile -- <workspace-slug> [--dry-run|--apply]")
  process.exit(1)
}

const environment = process.env.STRIPE_ENVIRONMENT
if (!environment || !["sandbox", "live"].includes(environment)) {
  console.error("STRIPE_ENVIRONMENT must be sandbox or live.")
  process.exit(1)
}
if (process.env.NODE_ENV === "production" && process.env.BILLING_ALLOW_LIVE_RECONCILE !== "true") {
  console.error("Refusing reconciliation in production without BILLING_ALLOW_LIVE_RECONCILE=true.")
  process.exit(1)
}
if (environment === "live" && process.env.BILLING_ALLOW_LIVE_RECONCILE !== "true") {
  console.error("Refusing live reconciliation without BILLING_ALLOW_LIVE_RECONCILE=true.")
  process.exit(1)
}

const apiKey = process.env.STRIPE_SECRET_KEY
const expectedAccountId = process.env.STRIPE_ACCOUNT_ID
const matchesKeyMode = environment === "sandbox" ? /^(sk|rk)_test_/.test(apiKey || "") : /^(sk|rk)_live_/.test(apiKey || "")
if (!matchesKeyMode || !expectedAccountId || !/^acct_[A-Za-z0-9]+$/.test(expectedAccountId)) {
  console.error("A matching STRIPE_SECRET_KEY and STRIPE_ACCOUNT_ID are required.")
  process.exit(1)
}

const neon = process.env.NEXT_PUBLIC_SAAS_CORE_BACKEND === "neon"
const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!neon && (!supabaseUrl || !serviceRoleKey)) {
  console.error("Server-only Supabase environment variables are required.")
  process.exit(1)
}
if (!dryRun && environment === "sandbox" && !(neon ? (await import("@sapienx/saas-core/postgres")).matchesNeonDataEnvironment("local") : /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(supabaseUrl))) {
  console.error("Sandbox reconciliation can only write to a local database endpoint.")
  process.exit(1)
}

const supabase = neon
  ? (await import("@sapienx/saas-core/postgres")).createNeonServerDataClient({ role: "service_role" })
  : createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const stripe = new Stripe(apiKey, { apiVersion: "2026-09-30.endive", maxNetworkRetries: 2, timeout: 20_000 })
const account = await stripe.accounts.retrieve(null).catch(() => null)
if (!account || account.id !== expectedAccountId) {
  console.error("Stripe account binding could not be verified. No local state was changed.")
  process.exit(1)
}

const { data: workspace, error: workspaceError } = await supabase
  .from("workspaces")
  .select("id, slug")
  .eq("slug", workspaceSlug)
  .single()
if (workspaceError || !workspace) {
  console.error("Workspace not found.")
  process.exit(1)
}

const { data: localState, error: stateError } = await supabase
  .from("workspace_subscriptions")
  .select("workspace_id, provider, provider_environment, provider_subscription_id, provider_customer_id, billing_projection_revision")
  .eq("workspace_id", workspace.id)
  .single()
if (stateError || !localState?.provider_subscription_id || localState.provider !== "stripe") {
  console.error("Workspace does not have a Stripe subscription to reconcile.")
  process.exit(1)
}
if (localState.provider_environment !== environment) {
  console.error("Workspace subscription environment does not match STRIPE_ENVIRONMENT.")
  process.exit(1)
}

let subscription
let committed = false
try {
  subscription = await stripe.subscriptions.retrieve(localState.provider_subscription_id, { expand: ["items.data.price.product", "schedule"] })
} catch {
  console.error("Could not retrieve the Stripe subscription from the configured account.")
  process.exit(1)
}
if (subscription.livemode !== (environment === "live")) {
  console.error("Stripe subscription mode does not match STRIPE_ENVIRONMENT. No local state was changed.")
  process.exit(1)
}
const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id
if (subscription.id !== localState.provider_subscription_id || !customerId || customerId !== localState.provider_customer_id) {
  console.error("The Stripe subscription or customer does not match the stored Workspace link. No local state was changed.")
  process.exit(1)
}
const metadata = subscription.metadata || {}
if ((metadata.workspace_id && metadata.workspace_id !== workspace.id) ||
  (metadata.billing_environment && metadata.billing_environment !== environment) ||
  (metadata.billing_provider && metadata.billing_provider !== "stripe")) {
  console.error("Stripe subscription metadata does not match this Workspace and environment. No local state was changed.")
  process.exit(1)
}
const items = subscription.items.data
if (items.length !== 1 || items[0]?.quantity !== 1 || !items[0]?.price?.id) {
  console.error("Stripe subscription has an unsupported item shape. No local state was changed.")
  process.exit(1)
}
const item = items[0]
const providerPriceId = item.price.id
const providerProductId = typeof item.price.product === "string" ? item.price.product : item.price.product.id
const { data: mapping, error: mappingError } = await supabase
  .from("billing_provider_prices")
  .select("plan_key, billing_interval, currency, provider_product_id")
  .eq("provider", "stripe")
  .eq("environment", environment)
  .eq("provider_price_id", providerPriceId)
  .maybeSingle()
if (mappingError || !mapping || mapping.provider_product_id !== providerProductId) {
  console.error("The Stripe Price and Product are not registered for this environment. No local state was changed.")
  process.exit(1)
}

let status
switch (subscription.status) {
  case "active": status = subscription.pause_collection ? "paused" : "active"; break
  case "trialing": status = "trialing"; break
  case "past_due": status = "past_due"; break
  case "paused": status = "paused"; break
  case "canceled": status = "canceled"; break
  case "incomplete": status = "pending"; break
  case "incomplete_expired": status = "expired"; break
  case "unpaid": status = "unpaid"; break
  default:
    console.error("Stripe subscription has an unsupported status. No local state was changed.")
    process.exit(1)
}

let schedule = typeof subscription.schedule === "object" ? subscription.schedule : null
if (schedule?.status === "active" && (schedule.metadata?.billing_provider !== "stripe" || !["saas-core", "placedj"].includes(schedule.metadata?.billing_integration))) {
  console.error("Stripe subscription has a schedule that is not managed by SaaS Core. No local state was changed.")
  process.exit(1)
}
if (schedule?.status !== "active") schedule = null
const currentPhase = schedule?.current_phase
const futurePhase = currentPhase ? schedule.phases.find((phase) => phase.start_date >= currentPhase.end_date) : null
let scheduledPlan = null
if (futurePhase) {
  if (futurePhase.items.length !== 1 || (futurePhase.items[0]?.quantity ?? 1) !== 1) {
    console.error("The Stripe schedule contains an unsupported future phase. No local state was changed.")
    process.exit(1)
  }
  const targetPrice = futurePhase.items[0].price
  const targetPriceId = typeof targetPrice === "string" ? targetPrice : targetPrice.id
  const { data: targetMapping, error: targetMappingError } = await supabase
    .from("billing_provider_prices")
    .select("plan_key, billing_interval, provider_product_id")
    .eq("provider", "stripe")
    .eq("environment", environment)
    .eq("provider_price_id", targetPriceId)
    .maybeSingle()
  if (targetMappingError || !targetMapping) {
    console.error("The future Stripe Price is not registered for this environment. No local state was changed.")
    process.exit(1)
  }
  scheduledPlan = { ...targetMapping, providerPriceId: targetPriceId, effectiveAt: new Date(futurePhase.start_date * 1000).toISOString() }
}

const configuredDefault = await supabase.rpc("get_core_default_plan_key")
if (configuredDefault.error || typeof configuredDefault.data !== "string" || !configuredDefault.data) {
  console.error("No active fallback plan is configured. No local state was changed.")
  process.exit(1)
}

const periodStartAt = item.current_period_start ? new Date(item.current_period_start * 1000).toISOString() : null
const periodEndAt = item.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null
const { data: latestState, error: latestStateError } = await supabase
  .from("workspace_subscriptions")
  .select("current_period_end_at, current_period_end, payment_failure_started_at, payment_grace_ends_at, billing_projection_revision")
  .eq("workspace_id", workspace.id)
  .single()
if (latestStateError || !latestState || latestState.billing_projection_revision !== localState.billing_projection_revision) {
  console.error("Could not read the current Workspace billing projection. No local state was changed.")
  process.exit(1)
}
if (["active", "trialing", "past_due"].includes(status)) {
  const previousEnd = Date.parse(latestState.current_period_end_at || latestState.current_period_end || "")
  const start = Date.parse(periodStartAt || "")
  const end = Date.parse(periodEndAt || "")
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    console.error("The Stripe subscription has no valid billing period. No local state was changed.")
    process.exit(1)
  }
  const advancesPeriod = status !== "trialing" && (!Number.isFinite(previousEnd) || start >= previousEnd || end > previousEnd)
  if (advancesPeriod) {
    let paid = false
    try {
      paid = start <= Date.now() && await hasMatchingPaidStripePeriod(stripe, {
        id: subscription.id, customerId, livemode: subscription.livemode,
        currentBillingPeriod: { startsAt: periodStartAt, endsAt: periodEndAt },
        items: [{ id: item.id, priceId: providerPriceId, productId: providerProductId, quantity: 1 }],
      })
    } catch {
      console.error("Could not verify Stripe invoice evidence. No local state was changed.")
      process.exit(1)
    }
    if (!paid) {
      console.error("The new Stripe billing period has no verified paid invoice. No local state was changed.")
      process.exit(1)
    }
  }
}
const failureStartedAt = status === "past_due" ? latestState.payment_failure_started_at || new Date().toISOString() : null
const graceEndsAt = failureStartedAt ? latestState.payment_grace_ends_at || new Date(new Date(failureStartedAt).getTime() + 14 * 86400000).toISOString() : null
const graceExpired = status === "past_due" && graceEndsAt && new Date(graceEndsAt).getTime() <= Date.now()
const planKey = ["paused", "canceled", "pending", "expired", "unpaid"].includes(status) || graceExpired ? configuredDefault.data : mapping.plan_key
const occurredAt = new Date().toISOString()
const reconcileEventId = `reconcile:${subscription.id}:${occurredAt}`
const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end || subscription.cancel_at)
const effectiveCancellationAt = subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : cancelAtPeriodEnd ? periodEndAt : null

const report = {
  status: dryRun ? "DRY_RUN" : "READY",
  workspace: workspace.slug,
  environment,
  subscriptionId: subscription.id,
  planKey,
  providerStatus: subscription.status,
  scheduledPlan: scheduledPlan?.plan_key || null,
  effectiveAt: scheduledPlan?.effectiveAt || effectiveCancellationAt,
}
if (dryRun) {
  console.log(JSON.stringify(report))
  process.exit(0)
}

const leaseToken = randomUUID()
const { data: leaseData, error: leaseError } = await supabase.rpc("claim_billing_projection", {
  p_workspace_id: workspace.id,
  p_lease_token: leaseToken,
  p_lease_seconds: 30,
})
const lease = Array.isArray(leaseData) ? leaseData[0] : leaseData
if (leaseError || typeof lease?.lease_revision !== "number") {
  console.error("Workspace billing is being reconciled by another worker. No local state was changed.")
  process.exit(1)
}

try {
  if (lease.lease_revision !== latestState.billing_projection_revision) {
    throw new Error("The Workspace projection changed during reconciliation. Retry with a fresh Stripe read.")
  }
  const patch = {
    plan_key: planKey,
    status,
    source: "provider",
    provider: "stripe",
    provider_environment: environment,
    provider_customer_id: customerId,
    provider_subscription_id: subscription.id,
    provider_price_id: providerPriceId,
    billing_interval: mapping.billing_interval,
    billing_currency: mapping.currency,
    provider_status: subscription.status,
    current_period_start: periodStartAt?.slice(0, 10) || null,
    current_period_end: periodEndAt?.slice(0, 10) || null,
    current_period_start_at: periodStartAt,
    current_period_end_at: periodEndAt,
    cancel_at_period_end: cancelAtPeriodEnd,
    last_provider_event_at: occurredAt,
    last_provider_event_id: reconcileEventId,
    next_billed_at: periodEndAt,
    scheduled_change_at: cancelAtPeriodEnd ? effectiveCancellationAt : null,
    scheduled_change_action: cancelAtPeriodEnd ? "cancel" : null,
    scheduled_plan_key: scheduledPlan?.plan_key || null,
    scheduled_plan_at: scheduledPlan?.effectiveAt || null,
    scheduled_effective_at: scheduledPlan?.effectiveAt || null,
    scheduled_plan_interval: scheduledPlan?.billing_interval || null,
    scheduled_provider_price_id: scheduledPlan?.providerPriceId || null,
    payment_failure_started_at: failureStartedAt,
    payment_grace_ends_at: graceEndsAt,
    billing_issue_code: status === "past_due" ? (graceExpired ? "grace_expired" : "past_due") : null,
    billing_projection_revision: lease.lease_revision + 1,
    billing_projection_lease_token: null,
    billing_projection_lease_until: null,
  }
  const { data: updated, error: updateError } = await supabase.from("workspace_subscriptions")
    .update(patch)
    .eq("workspace_id", workspace.id)
    .eq("billing_projection_revision", lease.lease_revision)
    .eq("billing_projection_lease_token", leaseToken)
    .select("workspace_id")
    .maybeSingle()
  if (updateError || !updated) throw new Error(updateError?.message || "Projection lease was replaced before finalization.")
  committed = true
  console.log(JSON.stringify({ ...report, status: "RECONCILED" }))
} catch (error) {
  if (!committed) {
    await supabase.rpc("release_billing_projection", {
      p_workspace_id: workspace.id,
      p_lease_token: leaseToken,
      p_lease_revision: lease.lease_revision,
    }).catch(() => undefined)
  }
  console.error("Could not update the Workspace billing projection:", error instanceof Error ? error.message : "Unknown error")
  process.exit(1)
}
