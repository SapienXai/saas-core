"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { AuthorizationError, getCurrentWorkspace, requireUser, requireWorkspaceRole } from "@/lib/authorization"
import { BillingConfigurationError, BillingMutationRejectedError, BillingScheduleUnavailableError, isBillingDeferred } from "@/lib/billing/config"
import { getActiveProviderPrice, getProviderPriceByProviderId, isBillingInterval, isPaidPlanKey, type BillingInterval, type PaidPlanKey, type ProviderPriceMapping } from "@/lib/billing/price-mapping"
import { canResumePendingCheckout } from "@/lib/billing/checkout-resumption"
import { assertBillingCheckoutEnabled, canStartBillingCheckout, assertSubscriptionManagementEnabled, getBillingProviderAdapter, getBillingProviderEnvironment, getBillingProviderName, isBillingProviderConfigured, isSubscriptionManagementEnabled } from "@/lib/billing/providers"
import { getWorkspaceEntitlements, getWorkspaceUsage, validatePlanChangeEligibility } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import type { Json } from "@/types/supabase"
import { getConfiguredDefaultPlanKey, getConfiguredFallbackPlanKey, isTerminalBillingSubscription } from "@/lib/billing/reconciliation"
import { consumeBillingTransition, recordBillingMutationTransition, updateBillingMutationTransition } from "@/lib/billing/persistence"
import type { BillingTransitionKind, PlanChangeEligibility } from "@sapienx/saas-core"
import { getProductUsageResolvers } from "@/src/product/usage"
import { resolveBillingIntervalChangePolicy } from "@/lib/billing/interval-policy"
import { getBillingReturnUrl } from "@/lib/platform-urls"
import { reconcileBillingCheckoutSession, reconcileBillingSubscription } from "@/lib/billing/reconciliation-service"
import type { BillingProviderAdapter, ProviderSubscriptionSnapshot } from "@/lib/billing/provider"

const CANCELLATION_REASONS = new Set(["too_expensive", "not_using", "seasonal", "missing_feature", "technical_problem", "switching_solution", "other"])

type SubscriptionRow = {
  workspace_id: string
  plan_key: string
  status: string
  source: string
  current_period_start: string | null
  current_period_end: string | null
  current_period_start_at: string | null
  current_period_end_at: string | null
  cancel_at_period_end: boolean
  provider: string | null
  provider_environment: string | null
  provider_customer_id: string | null
  provider_subscription_id: string | null
  provider_price_id: string | null
  provider_status: string | null
  billing_interval: string | null
  billing_currency: string | null
  last_provider_event_at: string | null
  next_billed_at: string | null
  scheduled_change_at: string | null
  scheduled_change_action: string | null
  scheduled_effective_at: string | null
  scheduled_plan_key: string | null
  scheduled_plan_at: string | null
  scheduled_plan_interval: string | null
  scheduled_provider_price_id: string | null
  billing_issue_code: string | null
  payment_failure_started_at: string | null
  payment_grace_ends_at: string | null
}

type BillingMutation = {
  id: string
  status: string
  result: Json
  error_code: string | null
  fingerprint?: string | null
  created: boolean
}

type AuthoritativeBillingState = {
  subscription: ProviderSubscriptionSnapshot
  mapping: ProviderPriceMapping
}

type PlanChangeContext = {
  membership: NonNullable<Awaited<ReturnType<typeof getCurrentWorkspace>>>
  subscription: SubscriptionRow
  state: AuthoritativeBillingState
  mapping: ProviderPriceMapping
  interval: BillingInterval
  currentInterval: BillingInterval
  currentPriceId: string
  targetPrice: Awaited<ReturnType<BillingProviderAdapter["retrievePrice"]>>
  intervalPolicy: ReturnType<typeof resolveBillingIntervalChangePolicy>
  currentPeriodEndAt: string | null
  isDowngrade: boolean
  changeTiming: "immediate" | "period_end"
  resetBillingCycle: boolean
  prorationDate: number
}

async function requireCurrentWorkspaceOwner() {
  const membership = await getCurrentWorkspace()
  if (!membership) throw new AuthorizationError("FORBIDDEN", "No active workspace is available.")
  await requireWorkspaceRole(membership.workspace_id, ["owner"])
  return membership
}

async function getCurrentBillingSubscription(workspaceId: string): Promise<SubscriptionRow> {
  const supabase = createServiceRoleClient()
  let { data, error } = await supabase
    .from("workspace_subscriptions")
    .select("workspace_id, plan_key, status, source, current_period_start, current_period_end, current_period_start_at, current_period_end_at, cancel_at_period_end, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_price_id, provider_status, billing_interval, billing_currency, last_provider_event_at, next_billed_at, scheduled_change_at, scheduled_change_action, scheduled_effective_at, scheduled_plan_key, scheduled_plan_at, scheduled_plan_interval, scheduled_provider_price_id, billing_issue_code, payment_failure_started_at, payment_grace_ends_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (error?.code === "42703") {
    const legacy = await supabase.from("workspace_subscriptions").select("workspace_id, plan_key, status, source, current_period_start, current_period_end, cancel_at_period_end, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_price_id, provider_status, last_provider_event_at, next_billed_at, scheduled_change_at, scheduled_change_action, scheduled_plan_key, scheduled_plan_at, billing_issue_code").eq("workspace_id", workspaceId).maybeSingle()
    data = legacy.data ? { ...legacy.data, current_period_start_at: null, current_period_end_at: null, scheduled_effective_at: null, scheduled_plan_interval: null, scheduled_provider_price_id: null, billing_interval: null, billing_currency: null, payment_failure_started_at: null, payment_grace_ends_at: null } : null
    error = legacy.error
  }
  if (error) throw new Error(error.message)
  if (!data) {
    const fallbackPlanKey = await getConfiguredFallbackPlanKey(supabase)
    return {
      workspace_id: workspaceId, plan_key: fallbackPlanKey, status: "active", source: "system",
      current_period_start: null, current_period_end: null, current_period_start_at: null, current_period_end_at: null,
      cancel_at_period_end: false, provider: null, provider_environment: null, provider_customer_id: null,
      provider_subscription_id: null, provider_price_id: null, provider_status: null, billing_interval: null,
      billing_currency: null, last_provider_event_at: null, next_billed_at: null, scheduled_change_at: null,
      scheduled_change_action: null, scheduled_effective_at: null, scheduled_plan_key: null, scheduled_plan_at: null,
      scheduled_plan_interval: null, scheduled_provider_price_id: null, billing_issue_code: null,
      payment_failure_started_at: null, payment_grace_ends_at: null,
    }
  }
  return data
}

async function getAuthoritativeBillingState(subscription: SubscriptionRow): Promise<AuthoritativeBillingState> {
  const provider = getBillingProviderName()
  const environment = getBillingProviderEnvironment()
  if (subscription.provider !== provider || !subscription.provider_subscription_id) {
    throw new Error("No active billing subscription is available.")
  }
  if (subscription.provider_environment !== environment) throw new Error("Billing environment does not match the current subscription.")

  const adapter = getBillingProviderAdapter()
  const providerSubscription = await adapter.retrieveSubscription(subscription.provider_subscription_id)
  if (providerSubscription.issueCode === "unmanaged_subscription_schedule" || providerSubscription.issueCode === "unsupported_subscription_schedule") {
    throw new Error("The Stripe schedule is not in a supported PlaceDJ state; resolve it before changing this subscription.")
  }
  const workspaceMetadata = providerSubscription.customData.workspace_id || providerSubscription.customData.saas_core_workspace_id
  if (workspaceMetadata && workspaceMetadata !== subscription.workspace_id) throw new Error("Billing subscription belongs to another Workspace.")
  if (providerSubscription.customData.billing_environment && providerSubscription.customData.billing_environment !== environment) {
    throw new Error("Billing subscription belongs to another environment.")
  }
  if (providerSubscription.customData.billing_provider && providerSubscription.customData.billing_provider !== provider) {
    throw new Error("Billing subscription belongs to another provider.")
  }
  if (providerSubscription.livemode !== (environment === "live")) throw new Error("Billing subscription mode does not match this environment.")
  const item = providerSubscription.items.length === 1 ? providerSubscription.items[0] : null
  if (!item?.priceId || item.quantity !== 1) throw new Error("Billing subscription has an unsupported item configuration.")
  const mapping = await getProviderPriceByProviderId(provider, item.priceId, environment, false)
  if (!mapping || !isPaidPlanKey(mapping.plan_key)) throw new Error("The current subscription Price is not registered.")
  const price = await adapter.retrievePrice(item.priceId)
  assertMappedPrice(mapping, price, environment)
  return { subscription: providerSubscription, mapping }
}

function assertMappedPrice(mapping: ProviderPriceMapping, price: Awaited<ReturnType<BillingProviderAdapter["retrievePrice"]>>, environment: "sandbox" | "live") {
  if (price.livemode !== (environment === "live") ||
    price.productId !== mapping.provider_product_id ||
    price.currency !== mapping.currency ||
    price.interval !== mapping.billing_interval ||
    price.intervalCount !== 1 ||
    price.amount === null || price.amount <= 0) {
    throw new Error("Billing Price details do not match the registered Workspace plan mapping.")
  }
}

function normalizeRequestKey(value: string | undefined) {
  const candidate = value?.trim() || randomUUID()
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(candidate)) throw new Error("Invalid billing request key.")
  return candidate
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

function resultRecord(value: Json): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {}
}

function friendlyBillingError(error: unknown) {
  if (error instanceof AuthorizationError || error instanceof BillingScheduleUnavailableError || error instanceof BillingMutationRejectedError) return error.message
  if (error instanceof BillingConfigurationError && error.code === "BILLING_DEFERRED") return "Billing changes are temporarily unavailable."
  if (error instanceof Error && /not configured|must be set|invalid format/i.test(error.message)) return "Billing is not configured for this environment."
  const providerUnavailable = error instanceof Error && /past_due|cannot change|not change|temporarily unavailable/i.test(error.message)
  console.error("Billing action failed", { code: providerUnavailable ? "PROVIDER_CHANGE_UNAVAILABLE" : "BILLING_UNAVAILABLE" })
  return providerUnavailable ? "This billing change is temporarily unavailable. Refresh the page and try again." : "Billing service is temporarily unavailable. Please try again."
}

function isProjectionBusyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PROJECTION_BUSY"
}

async function reconcileAfterProviderMutation(subscriptionId: string, workspaceId: string) {
  try {
    await reconcileBillingSubscription(subscriptionId, workspaceId)
    return true
  } catch (error) {
    if (isProjectionBusyError(error)) return false
    throw error
  }
}

async function reconcileUnknownBillingMutation(workspaceId: string) {
  const supabase = createServiceRoleClient()
  const { data: unknown, error: mutationError } = await supabase.from("billing_mutations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "unknown")
    .limit(1)
    .maybeSingle()
  if (mutationError) throw new Error(mutationError.message)
  if (!unknown) return

  const { data: subscription, error: subscriptionError } = await supabase.from("workspace_subscriptions")
    .select("provider, provider_environment, provider_subscription_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (!subscription?.provider_subscription_id) return

  let provider: string
  let environment: "sandbox" | "live"
  try {
    provider = getBillingProviderName()
    environment = getBillingProviderEnvironment()
  } catch {
    return
  }
  if (subscription.provider !== provider || subscription.provider_environment !== environment) return

  await reconcileAfterProviderMutation(subscription.provider_subscription_id, workspaceId)
}

function downgradeEligibilityFailure(targetPlan: string, eligibility: PlanChangeEligibility) {
  return {
    success: false as const,
    message: "This downgrade is not currently available because the target plan cannot safely accommodate this workspace's usage.",
    data: { targetPlan, eligibility },
  }
}

function getBillingPresentation() {
  try {
    return {
      billingConfigured: isBillingProviderConfigured(),
      environment: getBillingProviderEnvironment(),
      billingDeferred: isBillingDeferred(),
    }
  } catch {
    return { billingConfigured: false, environment: null, billingDeferred: isBillingDeferred() }
  }
}

async function beginBillingMutation(workspaceId: string, requestKey: string, operation: string): Promise<BillingMutation> {
  const supabase = createServiceRoleClient()
  const existingRequest = await supabase.from("billing_mutations").select("id, status, result, error_code").eq("workspace_id", workspaceId).eq("request_key", requestKey).maybeSingle()
  if (existingRequest.error) throw new Error(existingRequest.error.message)
  if (existingRequest.data) {
    if (existingRequest.data.status === "unknown") {
      await reconcileUnknownBillingMutation(workspaceId)
      const refreshed = await supabase.from("billing_mutations").select("id, status, result, error_code").eq("id", existingRequest.data.id).maybeSingle()
      if (refreshed.error) throw new Error(refreshed.error.message)
      if (!refreshed.data) throw new Error("Billing request could not be reloaded after reconciliation.")
      return { ...refreshed.data, created: false }
    }
    return { ...existingRequest.data, created: false }
  }
  const pending = await supabase.from("billing_mutations").select("id").eq("workspace_id", workspaceId).eq("status", "pending").limit(1).maybeSingle()
  if (pending.error) throw new Error(pending.error.message)
  if (pending.data) throw new Error("Another billing change is already being processed.")
  await reconcileUnknownBillingMutation(workspaceId)
  const unresolved = await supabase.from("billing_mutations").select("id").eq("workspace_id", workspaceId).in("status", ["pending", "unknown"]).limit(1).maybeSingle()
  if (unresolved.error) throw new Error(unresolved.error.message)
  if (unresolved.data) throw new Error("Another billing change is already being processed.")
  const created = await supabase.from("billing_mutations").insert({ workspace_id: workspaceId, request_key: requestKey, operation, status: "pending" }).select("id, status, result, error_code").single()
  if (!created.error && created.data) return { ...created.data, created: true }
  if (created.error?.code === "23505") {
    const retry = await supabase.from("billing_mutations").select("id, status, result, error_code").eq("workspace_id", workspaceId).eq("request_key", requestKey).single()
    if (retry.error || !retry.data) throw new Error(retry.error?.message || "Billing request is already being processed.")
    return { ...retry.data, created: false }
  }
  throw new Error(created.error?.message || "Could not start billing request.")
}

async function saveBillingMutationResult(id: string, result: unknown) {
  const { error } = await createServiceRoleClient().from("billing_mutations").update({ result: asJson(result) }).eq("id", id)
  if (error) throw new Error(error.message)
}

async function finishBillingMutation(id: string, status: "succeeded" | "failed" | "unknown", result: unknown = {}, errorCode: string | null = null) {
  const { error } = await createServiceRoleClient().from("billing_mutations").update({ status, result: asJson(result), error_code: errorCode }).eq("id", id)
  if (error) throw new Error(error.message)
}

async function beginCanonicalTransition(mutation: BillingMutation, workspaceId: string, environment: "sandbox" | "live", kind: BillingTransitionKind, fromPlanKey?: string | null, toPlanKey?: string | null, effectiveAt?: string | null) {
  return recordBillingMutationTransition({
    mutationId: mutation.id, workspaceId, provider: getBillingProviderName(), environment,
    transitionKey: kind + ":" + mutation.id, kind, fromPlanKey, toPlanKey, effectiveAt, state: "pending",
  })
}

async function getCanonicalTransitionId(mutationId: string, kind?: BillingTransitionKind) {
  let query = createServiceRoleClient().from("billing_mutation_transitions").select("id").eq("mutation_id", mutationId)
  if (kind) query = query.eq("kind", kind)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  return typeof data?.id === "string" ? data.id : null
}

async function resumePendingCheckoutSession(input: {
  supabase: ReturnType<typeof createServiceRoleClient>
  adapter: BillingProviderAdapter
  workspaceId: string
  provider: string
  environment: "sandbox" | "live"
  planKey: string
  interval: BillingInterval
  priceId: string
}) {
  const { data: checkout, error } = await input.supabase.from("billing_checkout_sessions")
    .select("workspace_id, provider, environment, target_plan_key, provider_price_id, provider_transaction_id, idempotency_key, status")
    .eq("provider", input.provider)
    .eq("environment", input.environment)
    .eq("workspace_id", input.workspaceId)
    .eq("target_plan_key", input.planKey)
    .eq("provider_price_id", input.priceId)
    .eq("status", "created")
    .not("provider_transaction_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!checkout) return null

  const { data: mutation, error: mutationError } = await input.supabase.from("billing_mutations")
    .select("id, operation, status")
    .eq("workspace_id", input.workspaceId)
    .eq("id", checkout.idempotency_key)
    .maybeSingle()
  if (mutationError) throw new Error(mutationError.message)
  if (!mutation || !canResumePendingCheckout({
    checkout,
    mutation,
    workspaceId: input.workspaceId,
    provider: input.provider,
    environment: input.environment,
    planKey: input.planKey,
    priceId: input.priceId,
  })) return null

  const session = await input.adapter.retrieveCheckoutSession(checkout.provider_transaction_id!)
  if (session.id !== checkout.provider_transaction_id ||
    session.workspaceId !== input.workspaceId ||
    session.mutationId !== mutation.id ||
    session.livemode !== (input.environment === "live")) {
    throw new Error("The pending Checkout session does not match this Workspace request.")
  }
  if (session.status !== "open" || !session.url) {
    return { success: false as const, message: "The previous checkout is already being processed. Refresh the page and try again." }
  }

  const transitionId = await getCanonicalTransitionId(mutation.id, "checkout")
  await saveBillingMutationResult(mutation.id, { sessionId: session.id, transitionId, planKey: input.planKey, interval: input.interval })
  return { success: true as const, data: { url: session.url, sessionId: session.id, transitionId } }
}

async function finishCanonicalTransition(transitionId: string, state: "succeeded" | "failed" | "unknown", outcome: Record<string, unknown> = {}, errorCode?: string) {
  await updateBillingMutationTransition({ transitionId, state, outcome, errorCode: state === "failed" ? errorCode || null : null })
}

async function persistUnknownProviderOutcome(mutation: BillingMutation, transitionId: string | null, error: unknown, operation: string) {
  if (error instanceof BillingMutationRejectedError || error instanceof BillingScheduleUnavailableError) {
    const code = error instanceof BillingMutationRejectedError ? "PROVIDER_CHANGE_REJECTED" : "BILLING_SCHEDULE_UNAVAILABLE"
    if (transitionId) await finishCanonicalTransition(transitionId, "failed", {}, code)
    await finishBillingMutation(mutation.id, "failed", {}, code)
    return
  }
  const reason = error instanceof Error ? error.message : String(error)
  if (transitionId) await finishCanonicalTransition(transitionId, "unknown", { status: "unknown", operation, reason: reason.slice(0, 500) })
  try {
    await finishBillingMutation(mutation.id, "unknown", { status: "unknown", operation, reason: reason.slice(0, 500) }, "PROVIDER_OUTCOME_UNKNOWN")
  } catch {
    console.error("Could not persist unknown billing mutation outcome", { code: "MUTATION_STATE_WRITE_FAILED" })
  }
}

async function ensureCheckoutEligibility(subscription: SubscriptionRow) {
  if (subscription.provider_subscription_id) {
    const observedStatus = subscription.provider_status || subscription.status
    if (!isTerminalBillingSubscription(observedStatus)) throw new Error("This workspace already has a billing subscription. Use Manage plan instead.")
    if (subscription.provider === getBillingProviderName()) {
      await reconcileBillingSubscription(subscription.provider_subscription_id, subscription.workspace_id)
      const reconciled = await getCurrentBillingSubscription(subscription.workspace_id)
      if (!isTerminalBillingSubscription(reconciled.provider_status || reconciled.status)) {
        throw new Error("The previous subscription is still being reconciled.")
      }
      return reconciled
    }
  }
  if (subscription.source !== "system" && subscription.source !== "provider" && subscription.source !== "trial") throw new Error("This workspace is not eligible for a new paid checkout.")
  return subscription
}

function planChangeFingerprint(subscription: Pick<SubscriptionRow, "provider_subscription_id" | "last_provider_event_at">, currentPriceId: string, targetPriceId: string) {
  return (subscription.provider_subscription_id || "") + ":" + currentPriceId + ":" + targetPriceId + ":" + (subscription.last_provider_event_at || "none")
}

async function getPlanName(planKey: string) {
  const { data, error } = await createServiceRoleClient().from("plans").select("name").eq("key", planKey).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.name || planKey
}

async function getPlanSortOrder(planKey: string) {
  const { data, error } = await createServiceRoleClient().from("plans").select("key, sort_order").eq("key", planKey).single()
  if (error || !data) throw new Error(error?.message || "Plan catalog could not be loaded.")
  return data.sort_order
}

async function getPlanChangeContext(targetPlan: PaidPlanKey, targetInterval?: BillingInterval, prorationDate = Math.floor(Date.now() / 1000)): Promise<PlanChangeContext> {
  const membership = await requireCurrentWorkspaceOwner()
  const subscription = await getCurrentBillingSubscription(membership.workspace_id)
  const state = await getAuthoritativeBillingState(subscription)
  const environment = getBillingProviderEnvironment()
  const hasPendingPlan = Boolean(subscription.scheduled_plan_key && (subscription.scheduled_effective_at || subscription.scheduled_plan_at))
  const currentInterval = hasPendingPlan && isBillingInterval(subscription.billing_interval || "")
    ? subscription.billing_interval as BillingInterval
    : state.mapping.billing_interval
  const interval = targetInterval || currentInterval
  const currency = state.mapping.currency || subscription.billing_currency || "USD"
  const mapping = await getActiveProviderPrice(targetPlan, getBillingProviderName(), environment, interval, currency)
  if (!mapping) throw new Error("The " + environment + " price mapping is not configured for " + targetPlan + ".")
  const adapter = getBillingProviderAdapter()
  const targetPrice = await adapter.retrievePrice(mapping.provider_price_id)
  assertMappedPrice(mapping, targetPrice, environment)
  if (state.subscription.cancelAtPeriodEnd || subscription.cancel_at_period_end) throw new Error("Reactivate the subscription before changing its plan.")
  if (state.subscription.status !== "active" && state.subscription.status !== "trialing") throw new Error("This subscription cannot be changed while its payment status is " + state.subscription.status + ".")
  if (subscription.plan_key === targetPlan && currentInterval === interval) throw new Error("The workspace is already on that plan and billing cycle.")
  if (state.subscription.scheduledPlan?.priceId === mapping.provider_price_id) {
    throw new Error("That plan and billing cycle are already scheduled for the end of this billing period.")
  }

  const currentPriceId = state.subscription.items[0]?.priceId
  if (!currentPriceId) throw new Error("The current billing Price is unavailable.")
  const intervalPolicy = targetPlan === subscription.plan_key
    ? resolveBillingIntervalChangePolicy(currentInterval, interval)
    : resolveBillingIntervalChangePolicy(null, null)
  const currentOrder = await getPlanSortOrder(subscription.plan_key)
  const targetOrder = await getPlanSortOrder(targetPlan)
  const isDowngrade = targetOrder < currentOrder
  const currentPeriodEndAt = state.subscription.currentBillingPeriod?.endsAt || subscription.current_period_end_at || subscription.current_period_end
  const replacesScheduledPlan = Boolean(state.subscription.scheduleId && state.subscription.scheduledPlan?.priceId !== mapping.provider_price_id)
  const replacesScheduledCycle = Boolean(state.subscription.scheduleId && targetPlan === subscription.plan_key && intervalPolicy.kind === "interval_change")
  const changeTiming = isDowngrade || intervalPolicy.timing === "period_end" || replacesScheduledPlan || replacesScheduledCycle ? "period_end" : "immediate"
  if (changeTiming === "period_end" && !currentPeriodEndAt) throw new Error("The current billing period end is unavailable.")
  return {
    membership, subscription, state, mapping, interval, currentInterval, currentPriceId, targetPrice,
    intervalPolicy, currentPeriodEndAt, isDowngrade, changeTiming,
    resetBillingCycle: intervalPolicy.kind === "interval_change" && intervalPolicy.timing === "immediate",
    prorationDate,
  }
}

async function calculatePlanChangePreview(context: PlanChangeContext) {
  const adapter = getBillingProviderAdapter()
  const targetPlan = context.mapping.plan_key
  let providerPreview = null as Awaited<ReturnType<BillingProviderAdapter["previewSubscriptionChange"]>> | null
  if (context.changeTiming === "immediate" || adapter.provider === "paddle") {
    const itemId = context.state.subscription.items[0]?.id
    if (!itemId || !context.state.subscription.customerId || !context.subscription.provider_subscription_id) throw new Error("The current subscription item is unavailable.")
    providerPreview = await adapter.previewSubscriptionChange({
      subscriptionId: context.subscription.provider_subscription_id,
      customerId: context.state.subscription.customerId,
      itemId,
      priceId: context.mapping.provider_price_id,
      prorationDate: context.prorationDate,
      ...(context.changeTiming === "period_end" && context.currentPeriodEndAt ? { effectiveAt: context.currentPeriodEndAt } : {}),
      ...(context.resetBillingCycle ? { resetBillingCycle: true } : {}),
    })
  }
  const previewAmount = providerPreview?.amount ?? 0
  const action = providerPreview?.action ?? "none"
  const effectiveAt = context.changeTiming === "period_end" ? context.currentPeriodEndAt : context.state.subscription.nextBilledAt
  return {
    planKey: targetPlan,
    plan: await getPlanName(targetPlan),
    interval: context.interval,
    isDowngrade: context.isDowngrade,
    changeTiming: context.changeTiming,
    prorationPolicy: context.changeTiming === "period_end" ? "none" : "immediate",
    action,
    amount: String(previewAmount),
    currency: providerPreview?.currency || context.mapping.currency,
    recurringAmount: providerPreview?.recurringAmount !== undefined ? String(providerPreview.recurringAmount) : context.targetPrice.amount === null ? null : String(context.targetPrice.amount),
    recurringCurrency: providerPreview?.recurringCurrency || context.targetPrice.currency,
    creditToBalance: String(providerPreview?.creditToBalance || 0),
    nextBilledAt: adapter.provider === "paddle" && providerPreview?.nextPaymentAttempt
      ? providerPreview.nextPaymentAttempt
      : context.state.subscription.nextBilledAt,
    effectiveAt,
    prorationDate: context.prorationDate,
    fingerprint: planChangeFingerprint(context.subscription, context.currentPriceId, context.mapping.provider_price_id),
  }
}

export async function getPlanUsage() {
  try {
    await requireUser()
    const membership = await getCurrentWorkspace()
    if (!membership) return { success: false, message: "No active workspace is available." }
    const supabase = createServiceRoleClient()
    const [{ data: workspace, error: workspaceError }, entitlements, usage, subscription, plans] = await Promise.all([
      supabase.from("workspaces").select("id, name, slug").eq("id", membership.workspace_id).single(),
      getWorkspaceEntitlements(membership.workspace_id),
      getWorkspaceUsage(membership.workspace_id, { usageResolvers: getProductUsageResolvers() }),
      getCurrentBillingSubscription(membership.workspace_id),
      supabase.from("plans").select("key, name, sort_order, active, features, limits, metadata").eq("active", true).order("sort_order"),
    ])
    if (workspaceError || !workspace) return { success: false, message: "Workspace could not be loaded." }
    if (plans.error) throw new Error(plans.error.message)

    const presentation = getBillingPresentation()
    const environment = presentation.environment
    const provider = getBillingProviderName()
    const adapter = presentation.billingConfigured ? getBillingProviderAdapter() : null
    let configuredPrices: Array<{ planKey: string; interval: string; currency: string; providerPriceId: string; amount: string | null }> = []
    if (environment && adapter) {
      const mappings = await supabase.from("billing_provider_prices")
        .select("plan_key, billing_interval, currency, provider_price_id")
        .eq("provider", provider).eq("environment", environment).eq("active", true)
      if (mappings.error) throw new Error(mappings.error.message)
      configuredPrices = await Promise.all((mappings.data || []).map(async (row) => {
        try {
          const price = await adapter.retrievePrice(row.provider_price_id)
          return { planKey: row.plan_key, interval: row.billing_interval, currency: row.currency, providerPriceId: row.provider_price_id, amount: price.amount === null ? null : String(price.amount) }
        } catch {
          return { planKey: row.plan_key, interval: row.billing_interval, currency: row.currency, providerPriceId: row.provider_price_id, amount: null }
        }
      }))
    }

    let authoritative: AuthoritativeBillingState | null = null
    if (subscription.provider === provider && subscription.provider_subscription_id && adapter) {
      try { authoritative = await getAuthoritativeBillingState(subscription) } catch { authoritative = null }
    }
    const hasPendingPlan = Boolean(subscription.scheduled_plan_key && (subscription.scheduled_effective_at || subscription.scheduled_plan_at))
    const currentPriceId = authoritative?.subscription.items[0]?.priceId || subscription.provider_price_id
    const currentMapping = authoritative?.mapping || (currentPriceId && environment
      ? await getProviderPriceByProviderId(provider, currentPriceId, environment, false).catch(() => null)
      : null)
    const resolvedInterval = currentMapping?.billing_interval || subscription.billing_interval
    const resolvedCurrency = currentMapping?.currency || subscription.billing_currency || "USD"
    let currentPriceAmount: string | null = null
    if (currentPriceId && adapter && authoritative) {
      try {
        const price = await adapter.retrievePrice(currentPriceId)
        currentPriceAmount = price.amount === null ? null : String(price.amount)
      } catch { currentPriceAmount = null }
    }
    let paymentMethod: { type: string; last4: string | null; expiryMonth: number | null; expiryYear: number | null } | null = null
    if (subscription.provider === provider && subscription.provider_customer_id && adapter) {
      try { paymentMethod = await adapter.getCustomerPaymentMethod(subscription.provider_customer_id) } catch { paymentMethod = null }
    }
    const resolvedStatus = authoritative?.subscription.providerStatus || subscription.provider_status
    const currentPeriodStart = authoritative?.subscription.currentBillingPeriod?.startsAt || subscription.current_period_start_at || subscription.current_period_start
    const currentPeriodEnd = authoritative?.subscription.currentBillingPeriod?.endsAt || subscription.current_period_end_at || subscription.current_period_end
    const nextBilledAt = authoritative?.subscription.nextBilledAt || subscription.next_billed_at
    return {
      success: true,
      data: {
        workspace, entitlements, usage,
        billing: {
          canManage: membership.role === "owner",
          canStartCheckout: membership.role === "owner" && presentation.billingConfigured && canStartBillingCheckout(membership.workspace_id),
          isProviderBacked: subscription.provider === provider && Boolean(subscription.provider_subscription_id),
          canManageProvider: isSubscriptionManagementEnabled() && membership.role === "owner" && subscription.provider === provider && Boolean(subscription.provider_subscription_id) && presentation.billingConfigured && !presentation.billingDeferred,
          canUsePortal: membership.role === "owner" && subscription.provider === provider && Boolean(subscription.provider_subscription_id && subscription.provider_customer_id) && presentation.billingConfigured && !presentation.billingDeferred,
          billingConfigured: presentation.billingConfigured,
          billingDeferred: presentation.billingDeferred,
          environment: subscription.provider_environment || environment,
          customerId: subscription.provider_customer_id,
          subscriptionId: subscription.provider_subscription_id,
          providerStatus: resolvedStatus,
          currentPeriodStart,
          currentPeriodEnd,
          nextBilledAt,
          cancelAtPeriodEnd: authoritative?.subscription.cancelAtPeriodEnd || subscription.cancel_at_period_end,
          scheduledChangeAt: authoritative?.subscription.cancelEffectiveAt || subscription.scheduled_effective_at || subscription.scheduled_change_at || currentPeriodEnd,
          scheduledChangeAction: authoritative?.subscription.cancelAtPeriodEnd ? "cancel" : subscription.scheduled_change_action,
          scheduledPlanKey: subscription.scheduled_plan_key,
          scheduledPlanAt: subscription.scheduled_effective_at || subscription.scheduled_plan_at,
          scheduledPlanInterval: subscription.scheduled_plan_interval,
          billingInterval: resolvedInterval,
          billingCurrency: resolvedCurrency,
          currentProviderPriceId: currentPriceId,
          currentProviderPriceAmount: currentPriceAmount,
          billingIssueCode: subscription.billing_issue_code || (resolvedStatus === "past_due" ? "past_due" : null),
          paymentFailureStartedAt: subscription.payment_failure_started_at,
          paymentGraceEndsAt: subscription.payment_grace_ends_at,
          paymentMethod,
          hasPendingPlan,
        },
        plans: plans.data || [],
        configuredPaidPlans: Array.from(new Set(configuredPrices.map((row) => row.planKey))),
        configuredPrices,
      },
    }
  } catch (error) {
    console.error("Error loading workspace plan and usage:", { code: "BILLING_OVERVIEW_FAILED" })
    return { success: false, message: error instanceof AuthorizationError ? error.message : "Plan and usage could not be loaded." }
  }
}

export async function reconcileSubscription() {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== getBillingProviderName() || !subscription.provider_subscription_id) return { success: false, message: "No active billing subscription is available." }
    const result = await reconcileBillingSubscription(subscription.provider_subscription_id, membership.workspace_id)
    revalidatePath("/manage/plan")
    return { success: true, data: result }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

function checkoutVerificationFailure(message: string) {
  return { success: false as const, message, data: { pending: false as const } }
}

export async function reconcileCheckoutSession(checkoutSessionId: string) {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const id = checkoutSessionId?.trim() || ""
    if (id.length < 1 || id.length > 255 || /\s/.test(id)) return checkoutVerificationFailure("Checkout could not be verified.")
    const result = await reconcileBillingCheckoutSession(id, membership.workspace_id)
    if (result.status === "pending") return { success: false as const, message: "Payment is still being confirmed.", data: { pending: true as const } }
    if (result.status === "failed") return checkoutVerificationFailure("Checkout could not be verified.")
    revalidatePath("/manage/plan")
    return { success: true as const, data: { pending: false as const, ...result } }
  } catch (error) {
    return { success: false as const, message: friendlyBillingError(error), data: { pending: true as const } }
  }
}

export async function consumeBillingTransitionForCurrentUser(transitionId: string) {
  try {
    const access = await requireUser()
    const membership = await getCurrentWorkspace()
    if (!membership) return { success: false, message: "No active workspace is available." }
    const result = await consumeBillingTransition({ workspaceId: membership.workspace_id, userId: access.userId, transitionId: transitionId?.trim() || "" })
    if (result.state !== "succeeded") return { success: false, message: "This billing transition is still being confirmed.", data: result }
    return { success: true, data: result }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function previewCheckout(targetPlan: string, billingInterval = "month") {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    assertBillingCheckoutEnabled(membership.workspace_id)
    const planKey = targetPlan?.trim() || await getConfiguredDefaultPlanKey()
    if (!isPaidPlanKey(planKey) || !isBillingInterval(billingInterval)) return { success: false, message: "That plan or billing cycle is not available." }
    const environment = getBillingProviderEnvironment()
    const provider = getBillingProviderName()
    const mapping = await getActiveProviderPrice(planKey, provider, environment, billingInterval, "USD")
    if (!mapping) return { success: false, message: "The " + environment + " price mapping is not configured for " + planKey + "." }
    const adapter = getBillingProviderAdapter()
    const price = await adapter.retrievePrice(mapping.provider_price_id)
    assertMappedPrice(mapping, price, environment)
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider_subscription_id || subscription.source !== "system") await ensureCheckoutEligibility(subscription)
    if (subscription.provider === provider && subscription.provider_subscription_id && !isTerminalBillingSubscription(subscription.provider_status)) {
      return { success: false, message: "This workspace already has a billing subscription. Use Manage plan instead." }
    }
    return {
      success: true,
      data: {
        planKey, plan: await getPlanName(planKey), interval: billingInterval,
        amount: String(price.amount), currency: price.currency, nextRecurringAmount: String(price.amount),
      },
    }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

function safeCheckoutReturnPath(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return "/manage/plan"
  try {
    const parsed = new URL(value, "https://saas-core.invalid")
    if (parsed.origin !== "https://saas-core.invalid") return "/manage/plan"
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return "/manage/plan"
  }
}

function checkoutReturnUrl(sessionPlaceholder = true, planKey?: string, interval?: string, returnPath?: string) {
  const safePath = safeCheckoutReturnPath(returnPath)
  const separator = safePath.includes("?") ? "&" : "?"
  const session = "checkout_session_id=" + (sessionPlaceholder ? "{CHECKOUT_SESSION_ID}" : "")
  const plan = planKey ? "&plan=" + encodeURIComponent(planKey) : ""
  const billingInterval = interval ? "&interval=" + encodeURIComponent(interval) : ""
  return getBillingReturnUrl(safePath + separator + session + plan + billingInterval)
}

function checkoutCancelUrl(planKey: string, interval: string, returnPath?: string) {
  const parsed = new URL(safeCheckoutReturnPath(returnPath), "https://saas-core.invalid")
  parsed.searchParams.set("checkout", "cancelled")
  parsed.searchParams.set("plan", planKey)
  parsed.searchParams.set("interval", interval)
  return getBillingReturnUrl(parsed.pathname + parsed.search + parsed.hash)
}

export async function startCheckout(targetPlan: string, billingInterval = "month", requestKey?: string, returnPath?: string) {
  let mutation: BillingMutation | null = null
  let transitionId: string | null = null
  try {
    const membership = await requireCurrentWorkspaceOwner()
    assertBillingCheckoutEnabled(membership.workspace_id)
    const planKey = targetPlan?.trim() || await getConfiguredDefaultPlanKey()
    if (!isPaidPlanKey(planKey) || !isBillingInterval(billingInterval)) return { success: false, message: "That plan or billing cycle is not available." }
    const environment = getBillingProviderEnvironment()
    const provider = getBillingProviderName()
    const mapping = await getActiveProviderPrice(planKey, provider, environment, billingInterval, "USD")
    if (!mapping) return { success: false, message: "The " + environment + " price mapping is not configured for " + planKey + "." }
    const adapter = getBillingProviderAdapter()
    const price = await adapter.retrievePrice(mapping.provider_price_id)
    assertMappedPrice(mapping, price, environment)

    let subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider_subscription_id || subscription.source !== "system") subscription = await ensureCheckoutEligibility(subscription)
    if (subscription.provider === provider && subscription.provider_subscription_id && !isTerminalBillingSubscription(subscription.provider_status)) {
      return { success: false, message: "This workspace already has a billing subscription. Use Manage plan instead." }
    }

    const supabase = createServiceRoleClient()
    const resumedCheckout = await resumePendingCheckoutSession({
      supabase,
      adapter,
      workspaceId: membership.workspace_id,
      provider,
      environment,
      planKey,
      interval: billingInterval,
      priceId: mapping.provider_price_id,
    })
    if (resumedCheckout) return resumedCheckout

    mutation = await beginBillingMutation(membership.workspace_id, normalizeRequestKey(requestKey), "checkout")
    transitionId = await getCanonicalTransitionId(mutation.id, "checkout")
    if (mutation.status === "succeeded") {
      const stored = resultRecord(mutation.result)
      const savedSession = typeof stored.sessionId === "string" ? stored.sessionId : null
      if (savedSession) {
        const session = await adapter.retrieveCheckoutSession(savedSession)
        if (session.url) return { success: true, data: { url: session.url, sessionId: session.id, transitionId } }
      }
      return { success: true, data: { transitionId, sessionId: savedSession } }
    }

    const transition = transitionId
      ? { transition_id: transitionId }
      : await beginCanonicalTransition(mutation, membership.workspace_id, environment, "checkout", subscription.plan_key, planKey)
    transitionId = transition.transition_id
    const existing = await supabase.from("billing_checkout_sessions")
      .select("provider_transaction_id, status")
      .eq("provider", provider).eq("environment", environment)
      .eq("workspace_id", membership.workspace_id).eq("idempotency_key", mutation.id).maybeSingle()
    if (existing.error) throw new Error(existing.error.message)
    if (existing.data?.provider_transaction_id) {
      const session = await adapter.retrieveCheckoutSession(existing.data.provider_transaction_id)
      await saveBillingMutationResult(mutation.id, { sessionId: session.id, transitionId, planKey, interval: billingInterval })
      if (session.url) return { success: true, data: { url: session.url, sessionId: session.id, transitionId } }
      return { success: false, message: "Checkout is already being confirmed. Refresh in a moment to continue." }
    }

    // A Paddle transaction create has no reusable Stripe-style idempotency key.
    if (provider === "paddle" && !mutation.created) {
      return { success: false, message: "Checkout is already being confirmed. Refresh in a moment to continue." }
    }

    try {
      const session = await adapter.createCheckoutSession({
        mutationId: mutation.id,
        workspaceId: membership.workspace_id,
        planKey,
        interval: billingInterval,
        priceId: mapping.provider_price_id,
        customerId: subscription.provider_customer_id,
        successUrl: checkoutReturnUrl(true, planKey, billingInterval, returnPath),
        cancelUrl: checkoutCancelUrl(planKey, billingInterval, returnPath),
      })
      if (!session.id || !session.url || session.workspaceId !== membership.workspace_id || session.mutationId !== mutation.id || session.livemode !== (environment === "live")) {
        throw new Error("The billing provider did not return a verified hosted session.")
      }
      const checkoutError = await supabase.from("billing_checkout_sessions").insert({
        workspace_id: membership.workspace_id,
        provider,
        environment,
        target_plan_key: planKey,
        provider_price_id: mapping.provider_price_id,
        provider_transaction_id: session.id,
        idempotency_key: mutation.id,
        status: "created",
      }).then((result) => result.error)
      if (checkoutError && checkoutError.code !== "23505") throw new Error(checkoutError.message)
      await saveBillingMutationResult(mutation.id, { sessionId: session.id, transitionId, planKey, interval: billingInterval })
      return { success: true, data: { url: session.url, sessionId: session.id, transitionId } }
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transitionId, error, "checkout")
      throw error
    }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function createBillingPortalSession() {
  try {
    assertSubscriptionManagementEnabled()
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== getBillingProviderName() || !subscription.provider_customer_id ||
        !subscription.provider_subscription_id || subscription.provider_environment !== getBillingProviderEnvironment()) {
      return { success: false, message: "No active billing account is available." }
    }
    const user = subscription.provider === "paddle" && subscription.provider_environment === "sandbox" && process.env.NODE_ENV === "production"
      ? (await (await createSupabaseServerClient()).auth.getUser()).data.user : null
    const portal = await getBillingProviderAdapter().createPortalSession({
      confirmedBuyerEmail: user?.email_confirmed_at ? user.email : undefined,
      customerId: subscription.provider_customer_id,
      subscriptionId: subscription.provider_subscription_id,
      returnUrl: getBillingReturnUrl("/manage/plan"),
    })
    return { success: true, url: portal.url }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function previewPlanChange(targetPlan: string, targetInterval?: string) {
  try {
    assertSubscriptionManagementEnabled()
    if (!isPaidPlanKey(targetPlan)) return { success: false, message: "That plan is not available." }
    if (targetInterval && !isBillingInterval(targetInterval)) return { success: false, message: "That billing cycle is not available." }
    const context = await getPlanChangeContext(targetPlan as PaidPlanKey, targetInterval as BillingInterval | undefined)
    if (context.isDowngrade) {
      const eligibility = await validatePlanChangeEligibility(context.subscription.workspace_id, targetPlan)
      if (!eligibility.allowed) return downgradeEligibilityFailure(targetPlan, eligibility)
    }
    const data = await calculatePlanChangePreview(context)
    const previewToken = randomUUID()
    const { error } = await createServiceRoleClient().from("billing_mutations").insert({
      workspace_id: context.subscription.workspace_id,
      request_key: previewToken,
      operation: "plan_change",
      status: "succeeded",
      fingerprint: data.fingerprint,
      result: asJson({ ...data, previewToken, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() }),
    })
    if (error) throw new Error(error.message)
    return { success: true, data: { ...data, previewToken } }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function changePlan(targetPlan: string, previewToken?: string, requestKey?: string, targetInterval?: string) {
  let mutation: BillingMutation | null = null
  let transitionId: string | null = null
  try {
    assertSubscriptionManagementEnabled()
    if (!isPaidPlanKey(targetPlan)) return { success: false, message: "That plan is not available." }
    const membership = await requireCurrentWorkspaceOwner()
    let token = previewToken
    let preview = token
      ? await createServiceRoleClient().from("billing_mutations").select("id, status, result, error_code, fingerprint").eq("workspace_id", membership.workspace_id).eq("request_key", token).eq("operation", "plan_change").maybeSingle()
      : null
    if (!token || preview?.error || !preview?.data) {
      const generated = await previewPlanChange(targetPlan, targetInterval)
      if (!generated.success || !generated.data) return generated
      token = generated.data.previewToken
      preview = await createServiceRoleClient().from("billing_mutations").select("id, status, result, error_code, fingerprint").eq("workspace_id", membership.workspace_id).eq("request_key", token).eq("operation", "plan_change").maybeSingle()
    }
    const stored = preview?.data
    const saved = stored ? resultRecord(stored.result) : {}
    const expiresAt = typeof saved.expiresAt === "string" ? saved.expiresAt : ""
    if (!stored || stored.status !== "succeeded" || !expiresAt || expiresAt <= new Date().toISOString() || saved.planKey !== targetPlan) {
      return { success: false, message: "This billing preview has expired. Review the current amount again." }
    }

    const operationKey = normalizeRequestKey(requestKey)
    mutation = await beginBillingMutation(membership.workspace_id, operationKey, "plan_change")
    transitionId = await getCanonicalTransitionId(mutation.id)
    if (mutation.status === "succeeded") {
      const result = resultRecord(mutation.result)
      return { success: true, message: "Your billing change is already synchronized.", data: { transitionId: result.transitionId || transitionId } }
    }
    if (!mutation.created) return { success: false, message: "Another billing change is already being processed. Refresh in a moment to see its result." }

    const interval = typeof saved.interval === "string" && isBillingInterval(saved.interval)
      ? saved.interval
      : targetInterval && isBillingInterval(targetInterval) ? targetInterval : undefined
    const savedProrationDate = typeof saved.prorationDate === "number" ? saved.prorationDate : Math.floor(Date.now() / 1000)
    const context = await getPlanChangeContext(targetPlan as PaidPlanKey, interval, savedProrationDate)
    const currentFingerprint = planChangeFingerprint(context.subscription, context.currentPriceId, context.mapping.provider_price_id)
    if (typeof stored.fingerprint !== "string" || stored.fingerprint !== currentFingerprint) {
      await finishBillingMutation(mutation.id, "failed", {}, "PREVIEW_CHANGED")
      return { success: false, message: "The billing state changed. Review the new preview before confirming." }
    }

    const currentPreview = await calculatePlanChangePreview(context)
    const fieldsToMatch = ["amount", "action", "interval", "isDowngrade", "recurringAmount", "creditToBalance", "currency", "nextBilledAt", "effectiveAt", "changeTiming", "prorationPolicy", "prorationDate"]
    if (fieldsToMatch.some((field) => {
      const value = currentPreview[field as keyof typeof currentPreview]
      // An immediate Paddle interval change starts a new cycle at confirmation
      // time, so its predicted billing date can move by seconds.
      if (field === "nextBilledAt" && getBillingProviderName() === "paddle" && context.changeTiming === "immediate") {
        return String(value || "").slice(0, 10) !== String(saved[field] || "").slice(0, 10)
      }
      return value !== saved[field]
    })) {
      await finishBillingMutation(mutation.id, "failed", {}, "PREVIEW_CHANGED")
      return { success: false, message: "The billing amount changed. Review the new preview before confirming." }
    }

    if (context.isDowngrade) {
      const eligibility = await validatePlanChangeEligibility(membership.workspace_id, targetPlan)
      if (!eligibility.allowed) {
        await finishBillingMutation(mutation.id, "failed", { targetPlan, eligibility }, "PLAN_CHANGE_NOT_ELIGIBLE")
        return downgradeEligibilityFailure(targetPlan, eligibility)
      }
    }
    const kind: BillingTransitionKind = context.intervalPolicy.kind === "interval_change" ? "interval_change" : context.isDowngrade ? "downgrade" : "upgrade"
    const effectiveAt = context.changeTiming === "period_end" ? context.currentPeriodEndAt : null
    const transition = transitionId
      ? { transition_id: transitionId }
      : await beginCanonicalTransition(mutation, membership.workspace_id, getBillingProviderEnvironment(), kind, context.subscription.plan_key, targetPlan, effectiveAt)
    transitionId = transition.transition_id

    try {
      if (context.changeTiming === "period_end") {
        const periodEnd = context.currentPeriodEndAt
        if (!periodEnd || !context.subscription.provider_subscription_id) throw new Error("The current billing period end is unavailable.")
        const scheduled = await getBillingProviderAdapter().schedulePlanChange({
          subscriptionId: context.subscription.provider_subscription_id,
          currentPriceId: context.currentPriceId,
          targetPriceId: context.mapping.provider_price_id,
          targetPlanKey: targetPlan,
          targetInterval: context.interval,
          periodEnd: Math.floor(new Date(periodEnd).getTime() / 1000),
          intervalCount: context.interval === "year" ? 1 : 1,
          mutationId: mutation.id,
          idempotencyKey: mutation.id,
        })
        const adapter = getBillingProviderAdapter()
        const providerState = await adapter.retrieveSubscription(context.subscription.provider_subscription_id)
        if (providerState.scheduleId !== scheduled.scheduleId || providerState.scheduledPlan?.priceId !== context.mapping.provider_price_id ||
          Math.abs(new Date(providerState.scheduledPlan.effectiveAt).getTime() - new Date(scheduled.effectiveAt).getTime()) > 1000) {
          throw new Error("The scheduled billing change could not be verified with the payment provider.")
        }
        const reconciled = await reconcileAfterProviderMutation(context.subscription.provider_subscription_id, membership.workspace_id)
        if (reconciled) {
          const projected = await getCurrentBillingSubscription(membership.workspace_id)
          if (projected.scheduled_plan_key !== targetPlan || projected.scheduled_provider_price_id !== context.mapping.provider_price_id) {
            throw new Error("The scheduled billing change could not be verified in the Workspace projection.")
          }
        }
        await finishCanonicalTransition(transitionId, "succeeded", { targetPlan, interval: context.interval, effectiveAt: scheduled.effectiveAt, scheduleId: scheduled.scheduleId })
        await finishBillingMutation(mutation.id, "succeeded", { targetPlan, interval: context.interval, changeTiming: "period_end", effectiveAt: scheduled.effectiveAt, transitionId })
        revalidatePath("/manage/plan")
        return { success: true, message: context.isDowngrade ? "Your downgrade is scheduled for the end of the current billing period." : "Your billing cycle change is scheduled for the end of the current billing period.", data: { transitionId, effectiveAt: scheduled.effectiveAt, targetPlan, interval: context.interval, changeTiming: "period_end" } }
      }

      const itemId = context.state.subscription.items[0]?.id
      if (!itemId || !context.subscription.provider_subscription_id) throw new Error("The current subscription item is unavailable.")
      const providerUpdate = await getBillingProviderAdapter().updateSubscriptionPrice({
        subscriptionId: context.subscription.provider_subscription_id,
        itemId,
        priceId: context.mapping.provider_price_id,
        prorationDate: context.prorationDate,
        ...(context.resetBillingCycle ? { resetBillingCycle: true } : {}),
        idempotencyKey: mutation.id,
        metadata: {
          workspace_id: membership.workspace_id,
          billing_mutation_id: mutation.id,
          billing_mutation_kind: "plan_change",
          plan_key: targetPlan,
          billing_interval: context.interval,
          billing_environment: getBillingProviderEnvironment(),
          billing_provider: getBillingProviderName(),
        },
      })
      const reconciled = await reconcileAfterProviderMutation(context.subscription.provider_subscription_id, membership.workspace_id)
      const projected = reconciled ? await getCurrentBillingSubscription(membership.workspace_id) : null
      const projectedConfirmed = (projected?.provider_status === "active" || projected?.provider_status === "trialing")
        ? projected.plan_key === targetPlan && projected.provider_price_id === context.mapping.provider_price_id
        : false
      const providerConfirmed = (providerUpdate.status === "active" || providerUpdate.status === "trialing") &&
        providerUpdate.items[0]?.priceId === context.mapping.provider_price_id && !providerUpdate.hasPendingUpdate
      const isConfirmed = projectedConfirmed || providerConfirmed
      if (isConfirmed) {
        await finishCanonicalTransition(transitionId, "succeeded", { targetPlan, interval: context.interval, changeTiming: "immediate", providerReference: context.subscription.provider_subscription_id })
        await finishBillingMutation(mutation.id, "succeeded", { targetPlan, interval: context.interval, changeTiming: "immediate", transitionId })
      } else {
        await saveBillingMutationResult(mutation.id, { targetPlan, interval: context.interval, changeTiming: "immediate", transitionId })
      }
      revalidatePath("/manage/plan")
      return {
        success: true,
        message: isConfirmed ? "Your plan change is confirmed." : "Your plan change was submitted and is waiting for provider confirmation.",
        data: { transitionId, targetPlan, interval: context.interval, changeTiming: "immediate" },
      }
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transitionId, error, "plan_change")
      throw error
    }
  } catch (error) {
    if (mutation && mutation.status === "pending") {
      // Provider calls are idempotent; uncertain outcomes remain recoverable by reconciliation.
    }
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function undoPlanChange(requestKey?: string) {
  let transitionId: string | null = null
  try {
    assertSubscriptionManagementEnabled()
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (!subscription.scheduled_plan_key || !isPaidPlanKey(subscription.plan_key) || !subscription.provider_subscription_id) {
      return { success: false, message: "There is no pending plan change to undo." }
    }
    const state = await getAuthoritativeBillingState(subscription)
    if (!state.subscription.scheduleId) return { success: false, message: "The scheduled billing change could not be found." }
    const mutation = await beginBillingMutation(membership.workspace_id, normalizeRequestKey(requestKey), "plan_change")
    if (mutation.status === "succeeded") {
      const result = resultRecord(mutation.result)
      return { success: true, message: "The pending change is already being undone.", data: { transitionId: result.transitionId || await getCanonicalTransitionId(mutation.id) } }
    }
    if (!mutation.created) return { success: false, message: "Another billing change is already being processed. Refresh in a moment to see its result." }
    const intervalChange = subscription.scheduled_plan_key === subscription.plan_key &&
      isBillingInterval(subscription.scheduled_plan_interval || "") &&
      subscription.scheduled_plan_interval !== subscription.billing_interval
    const kind: BillingTransitionKind = intervalChange ? "interval_change" : "downgrade"
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, getBillingProviderEnvironment(), kind, subscription.scheduled_plan_key, subscription.plan_key)
    transitionId = transition.transition_id
    try {
      await getBillingProviderAdapter().releaseSchedule(subscription.provider_subscription_id, state.subscription.scheduleId, mutation.id)
      const providerState = await getBillingProviderAdapter().retrieveSubscription(subscription.provider_subscription_id)
      if (providerState.scheduleId || providerState.scheduledPlan) throw new Error("The scheduled billing change is still active with the payment provider.")
      const reconciled = await reconcileAfterProviderMutation(subscription.provider_subscription_id, membership.workspace_id)
      if (reconciled) {
        const updated = await getCurrentBillingSubscription(membership.workspace_id)
        if (updated.scheduled_plan_key) throw new Error("The scheduled billing change is still active in the Workspace projection.")
      }
      await finishCanonicalTransition(transitionId, "succeeded", { scheduleReleased: true })
      await finishBillingMutation(mutation.id, "succeeded", { transitionId })
      revalidatePath("/manage/plan")
      return { success: true, message: intervalChange ? "The pending billing cycle change was undone." : "The pending plan change was undone.", data: { transitionId } }
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transitionId, error, "undo_plan_change")
      throw error
    }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function cancelSubscription(reasonCode = "other", feedback = "", requestKey?: string) {
  let transitionId: string | null = null
  try {
    assertSubscriptionManagementEnabled()
    const membership = await requireCurrentWorkspaceOwner()
    if (!CANCELLATION_REASONS.has(reasonCode)) return { success: false, message: "Please choose a cancellation reason." }
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== getBillingProviderName() || !subscription.provider_subscription_id) return { success: false, message: "No active billing subscription is available." }
    const state = await getAuthoritativeBillingState(subscription)
    if ((subscription.scheduled_plan_key || state.subscription.scheduledPlan) && !state.subscription.scheduleId) {
      return { success: false, message: "The pending plan change could not be found with the payment provider. Refresh the page and try again." }
    }
    const mutation = await beginBillingMutation(membership.workspace_id, normalizeRequestKey(requestKey), "cancel")
    if (mutation.status === "succeeded") {
      const result = resultRecord(mutation.result)
      return { success: true, message: "Cancellation is already scheduled.", data: { transitionId: result.transitionId || await getCanonicalTransitionId(mutation.id, "cancel") } }
    }
    if (!mutation.created) return { success: false, message: "Another billing change is already being processed. Refresh in a moment to see its result." }
    const effectiveAt = state.subscription.currentBillingPeriod?.endsAt || subscription.current_period_end_at || subscription.current_period_end
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, getBillingProviderEnvironment(), "cancel", subscription.plan_key, subscription.plan_key, effectiveAt)
    transitionId = transition.transition_id
    try {
      const feedbackInsert = await createServiceRoleClient().from("billing_cancellation_feedback").insert({
        workspace_id: membership.workspace_id,
        provider_subscription_id: subscription.provider_subscription_id,
        reason_code: reasonCode,
        feedback: feedback.trim().slice(0, 1000) || null,
      })
      if (feedbackInsert.error) throw new Error(feedbackInsert.error.message)
      const adapter = getBillingProviderAdapter()
      if (state.subscription.scheduleId) {
        await adapter.releaseSchedule(subscription.provider_subscription_id, state.subscription.scheduleId, mutation.id, "cancel")
      }
      const updated = await adapter.scheduleCancellation(subscription.provider_subscription_id, mutation.id)
      if (!updated.cancelAtPeriodEnd) throw new Error("The payment provider did not schedule cancellation at the end of the billing period.")
      await reconcileAfterProviderMutation(subscription.provider_subscription_id, membership.workspace_id)
      const effective = updated.cancelEffectiveAt || effectiveAt
      await finishCanonicalTransition(transitionId, "succeeded", { effectiveAt: effective, providerReference: subscription.provider_subscription_id })
      await finishBillingMutation(mutation.id, "succeeded", { effectiveAt: effective, transitionId })
      revalidatePath("/manage/plan")
      return { success: true, message: "Cancellation scheduled for the end of the current billing period.", data: { transitionId, effectiveAt: effective } }
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transitionId, error, "cancel")
      throw error
    }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function resumeSubscription(requestKey?: string) {
  let transitionId: string | null = null
  try {
    assertSubscriptionManagementEnabled()
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== getBillingProviderName() || !subscription.provider_subscription_id) return { success: false, message: "No active billing subscription is available." }
    await getAuthoritativeBillingState(subscription)
    const mutation = await beginBillingMutation(membership.workspace_id, normalizeRequestKey(requestKey), "resume")
    if (mutation.status === "succeeded") {
      const result = resultRecord(mutation.result)
      return { success: true, message: "Your subscription is already being reactivated.", data: { transitionId: result.transitionId || await getCanonicalTransitionId(mutation.id, "resume") } }
    }
    if (!mutation.created) return { success: false, message: "Another billing change is already being processed. Refresh in a moment to see its result." }
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, getBillingProviderEnvironment(), "resume", subscription.plan_key, subscription.plan_key)
    transitionId = transition.transition_id
    try {
      const updated = await getBillingProviderAdapter().undoScheduledCancellation(subscription.provider_subscription_id, mutation.id)
      if (updated.cancelAtPeriodEnd) throw new Error("The subscription cancellation remains scheduled.")
      await reconcileAfterProviderMutation(subscription.provider_subscription_id, membership.workspace_id)
      await finishCanonicalTransition(transitionId, "succeeded", { cancellationUndone: true })
      await finishBillingMutation(mutation.id, "succeeded", { transitionId })
      revalidatePath("/manage/plan")
      return { success: true, message: "Your subscription has been reactivated.", data: { transitionId } }
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transitionId, error, "resume")
      throw error
    }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function startPaymentMethodRecovery() {
  return createBillingPortalSession()
}

export async function getBillingTransactions() {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== getBillingProviderName() || !subscription.provider_customer_id) return { success: true, data: [] }
    const invoices = await getBillingProviderAdapter().listInvoices(subscription.provider_customer_id, subscription.provider_subscription_id)
    return {
      success: true,
      data: invoices.map((invoice) => ({
        id: invoice.id,
        date: invoice.createdAt,
        status: invoice.status,
        amount: String(invoice.amountPaid || invoice.amountDue),
        currency: invoice.currency,
        invoiceNumber: invoice.number,
        invoiceId: invoice.id,
      })),
    }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function getBillingInvoiceUrl(invoiceId: string) {
  try {
    assertSubscriptionManagementEnabled()
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== getBillingProviderName() || !subscription.provider_customer_id || !invoiceId.trim()) {
      return { success: false, message: "Invoice is not available." }
    }
    const invoice = await getBillingProviderAdapter().retrieveInvoice(invoiceId.trim(), subscription.provider_customer_id, subscription.provider_subscription_id)
    if (invoice.hostedInvoiceUrl) return { success: true, url: invoice.hostedInvoiceUrl }
    if (invoice.pdfUrl) return { success: true, url: invoice.pdfUrl }
    return { success: false, message: "Invoice is not available." }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}
