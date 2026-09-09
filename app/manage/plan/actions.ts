"use server"

import { revalidatePath } from "next/cache"
import { AuthorizationError, getCurrentWorkspace, requireUser, requireWorkspaceRole } from "@/lib/authorization"
import { getBillingEnvironment, getPaddleServerClient, getPublicPaddleConfig, isPaddleBillingConfigured } from "@/lib/billing/paddle-client"
import { getActivePaddlePrice, getPaddlePriceByProviderId, isBillingInterval, isPaidPlanKey, type BillingInterval, type PaidPlanKey, type ProviderPriceMapping } from "@/lib/billing/price-mapping"
import { getWorkspaceEntitlements, getWorkspaceUsage } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import type { Json } from "@/types/supabase"
import { applyPaddleSubscriptionEvent } from "@/lib/billing/webhook"
import { getConfiguredDefaultPlanKey, isTerminalBillingSubscription } from "@/lib/billing/reconciliation"
import { recordBillingMutationTransition, updateBillingMutationTransition } from "@/lib/billing/persistence"
import type { BillingTransitionKind } from "@sapienx/saas-core"

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

type BillingMutation = { id: string; status: string; result: Json; error_code: string | null; created: boolean }

type AuthoritativePaddleState = {
  subscription: Awaited<ReturnType<ReturnType<typeof getPaddleServerClient>["subscriptions"]["get"]>>
  mapping: ProviderPriceMapping | null
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
    .single()
  if (error?.code === "42703") {
    const legacy = await supabase.from("workspace_subscriptions").select("workspace_id, plan_key, status, source, current_period_start, current_period_end, cancel_at_period_end, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_price_id, provider_status, last_provider_event_at, next_billed_at, scheduled_change_at, scheduled_change_action, scheduled_plan_key, scheduled_plan_at, billing_issue_code").eq("workspace_id", workspaceId).single()
    data = legacy.data ? { ...legacy.data, current_period_start_at: null, current_period_end_at: null, scheduled_effective_at: null, scheduled_plan_interval: null, scheduled_provider_price_id: null, billing_interval: null, billing_currency: null, payment_failure_started_at: null, payment_grace_ends_at: null } : null
    error = legacy.error
  }
  if (error || !data) throw new Error(error?.message || "Workspace subscription could not be loaded.")
  return data
}

async function getAuthoritativePaddleState(subscription: SubscriptionRow): Promise<AuthoritativePaddleState> {
  if (subscription.provider !== "paddle" || !subscription.provider_subscription_id) {
    throw new Error("No active Paddle subscription is available.")
  }

  const environment = getBillingEnvironment()
  if (subscription.provider_environment !== environment) {
    throw new Error("Billing environment does not match the current subscription.")
  }

  const providerSubscription = await getPaddleServerClient().subscriptions.get(subscription.provider_subscription_id)
  const providerPriceId = providerSubscription.items?.[0]?.price?.id || subscription.provider_price_id
  const mapping = providerPriceId ? await getPaddlePriceByProviderId(providerPriceId, environment, false) : null
  return { subscription: providerSubscription, mapping }
}

function paddleSubscriptionEventData(subscription: AuthoritativePaddleState["subscription"]): Record<string, unknown> {
  return {
    id: subscription.id,
    status: subscription.status,
    customerId: subscription.customerId,
    nextBilledAt: subscription.nextBilledAt,
    currentBillingPeriod: subscription.currentBillingPeriod
      ? { startsAt: subscription.currentBillingPeriod.startsAt, endsAt: subscription.currentBillingPeriod.endsAt }
      : null,
    scheduledChange: subscription.scheduledChange
      ? { action: subscription.scheduledChange.action, effectiveAt: subscription.scheduledChange.effectiveAt, resumeAt: subscription.scheduledChange.resumeAt }
      : null,
    customData: subscription.customData,
    items: subscription.items.map((item) => ({ priceId: item.price?.id || null, quantity: item.quantity })),
  }
}

async function reconcilePaddleSubscriptionProjection(subscription: SubscriptionRow) {
  const authoritative = await getAuthoritativePaddleState(subscription)
  const occurredAt = authoritative.subscription.updatedAt || new Date().toISOString()
  const result = await applyPaddleSubscriptionEvent({
    eventId: `reconcile_${authoritative.subscription.id}_${occurredAt}`,
    eventType: "subscription.updated",
    occurredAt,
    data: paddleSubscriptionEventData(authoritative.subscription),
  })
  return { authoritative, result }
}

async function ensureCheckoutEligibility(subscription: SubscriptionRow) {
  if (subscription.provider_subscription_id && !isTerminalBillingSubscription(subscription.provider_status || subscription.status)) {
    throw new Error("This workspace already has a Paddle subscription. Use Manage plan instead.")
  }
  if (subscription.provider_subscription_id && isTerminalBillingSubscription(subscription.provider_status || subscription.status)) {
    // A replacement checkout is safe only after the old provider object has
    // been observed as terminal through the canonical projection path.
    await reconcilePaddleSubscriptionProjection(subscription)
    const reconciled = await getCurrentBillingSubscription(subscription.workspace_id)
    if (reconciled.provider_status !== "canceled") throw new Error("The previous Paddle subscription is still being reconciled.")
    return reconciled
  }
  if (subscription.source !== "system") throw new Error("This workspace is not eligible for a new paid checkout.")
  return subscription
}

function providerPeriodEnd(state: AuthoritativePaddleState | null, fallback: SubscriptionRow) {
  return state?.subscription.currentBillingPeriod?.endsAt || fallback.current_period_end_at || fallback.current_period_end
}

function normalizeRequestKey(value: string | undefined) {
  const candidate = value?.trim() || crypto.randomUUID()
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(candidate)) throw new Error("Invalid billing request key.")
  return candidate
}

function asJson(value: unknown): Json { return JSON.parse(JSON.stringify(value)) as Json }

function friendlyBillingError(error: unknown) {
  if (error instanceof AuthorizationError) return error.message
  if (error instanceof Error && error.message.includes("not configured")) return "Billing is not configured for this environment."
  const providerUnavailable = error instanceof Error && /past_due|30 minutes|cannot change|not change/i.test(error.message)
  console.error("Billing action failed", { code: providerUnavailable ? "PROVIDER_CHANGE_UNAVAILABLE" : "BILLING_UNAVAILABLE" })
  return providerUnavailable ? "This billing change is temporarily unavailable. Refresh the page and try again." : "Billing service is temporarily unavailable. Please try again."
}

function getBillingPresentation() {
  try {
    const environment = getBillingEnvironment()
    return { paddleConfigured: isPaddleBillingConfigured() && Boolean(getPublicPaddleConfig()), environment }
  } catch { return { paddleConfigured: false, environment: null } }
}

async function beginBillingMutation(workspaceId: string, requestKey: string, operation: string): Promise<BillingMutation> {
  const supabase = createServiceRoleClient()
  const existingRequest = await supabase.from("billing_mutations").select("id, status, result, error_code").eq("workspace_id", workspaceId).eq("request_key", requestKey).maybeSingle()
  if (existingRequest.error) throw new Error(existingRequest.error.message)
  if (existingRequest.data) return { ...existingRequest.data, created: false }
  const pending = await supabase.from("billing_mutations").select("id, status, result, error_code").eq("workspace_id", workspaceId).in("status", ["pending", "unknown"]).limit(1).maybeSingle()
  if (pending.error) throw new Error(pending.error.message)
  if (pending.data) throw new Error("Another billing change is already being processed.")
  const created = await supabase.from("billing_mutations").insert({ workspace_id: workspaceId, request_key: requestKey, operation, status: "pending" }).select("id, status, result, error_code").single()
  if (!created.error && created.data) return { ...created.data, created: true }
  if (created.error?.code === "23505") {
    const retry = await supabase.from("billing_mutations").select("id, status, result, error_code").eq("workspace_id", workspaceId).eq("request_key", requestKey).single()
    if (retry.error || !retry.data) throw new Error(retry.error?.message || "Billing request is already being processed.")
    return { ...retry.data, created: false }
  }
  throw new Error(created.error?.message || "Could not start billing request.")
}

async function finishBillingMutation(id: string, status: "succeeded" | "failed" | "unknown", result: unknown = {}, errorCode: string | null = null) {
  const { error } = await createServiceRoleClient().from("billing_mutations").update({ status, result: asJson(result), error_code: errorCode }).eq("id", id)
  if (error) console.error("Could not persist billing mutation state", { code: "MUTATION_STATE_WRITE_FAILED" })
}

async function beginCanonicalTransition(
  mutation: BillingMutation,
  workspaceId: string,
  environment: "sandbox" | "live",
  kind: BillingTransitionKind,
  fromPlanKey?: string | null,
  toPlanKey?: string | null,
  effectiveAt?: string | null,
) {
  return recordBillingMutationTransition({
    mutationId: mutation.id,
    workspaceId,
    provider: "paddle",
    environment,
    transitionKey: `${kind}:${mutation.id}`,
    kind,
    fromPlanKey,
    toPlanKey,
    effectiveAt,
    state: "pending",
  })
}

async function finishCanonicalTransition(transitionId: string, state: "succeeded" | "failed" | "unknown", outcome: Record<string, unknown> = {}, errorCode?: string) {
  await updateBillingMutationTransition({
    transitionId,
    state,
    outcome,
    errorCode: state === "failed" ? errorCode || null : null,
  })
}

async function persistUnknownProviderOutcome(mutation: BillingMutation, transitionId: string | null, error: unknown, operation: string) {
  const message = error instanceof Error ? error.message : String(error)
  if (transitionId) await finishCanonicalTransition(transitionId, "unknown", { status: "unknown", operation, reason: message.slice(0, 500) })
  await finishBillingMutation(mutation.id, "unknown", { status: "unknown", operation, reason: message.slice(0, 500) }, "PROVIDER_OUTCOME_UNKNOWN")
}

function resultRecord(value: Json): Record<string, Json> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {} }
function moneyAmount(value: string | null | undefined) { return value && /^\d+$/.test(value) ? value : null }
function positiveMoneyAmount(value: string | null | undefined) {
  const amount = moneyAmount(value)
  return amount && !/^0+$/.test(amount) ? amount : null
}

async function subscriptionPreviewData(
  preview: Awaited<ReturnType<ReturnType<typeof getPaddleServerClient>["subscriptions"]["previewUpdate"]>>,
  targetPlan: PaidPlanKey,
  targetInterval: BillingInterval,
  mode: string,
  isDowngrade: boolean,
  effectiveAt: string | null,
  targetPrice: ProviderPriceMapping,
) {
  const result = preview.updateSummary?.result
  const immediate = preview.immediateTransaction?.details?.totals
  const next = preview.nextTransaction?.details?.totals
  const authoritativePrice = await getPaddleServerClient().prices.get(targetPrice.provider_price_id)
  const recurringAmount = positiveMoneyAmount(authoritativePrice.unitPrice.amount)
  if (!recurringAmount) throw new Error("The target Paddle price is unavailable.")
  const targetPlanName = await getPlanName(targetPlan)
  return {
    planKey: targetPlan,
    plan: targetPlanName,
    interval: targetInterval,
    isDowngrade,
    prorationBillingMode: mode,
    action: result?.action || null,
    amount: moneyAmount(result?.amount),
    currency: result?.currencyCode || preview.currencyCode || null,
    recurringAmount,
    recurringCurrency: authoritativePrice.unitPrice.currencyCode || targetPrice.currency,
    immediateAmount: moneyAmount(immediate?.grandTotal || immediate?.total),
    creditToBalance: positiveMoneyAmount(immediate?.creditToBalance || next?.creditToBalance),
    nextBilledAt: preview.nextBilledAt || null,
    effectiveAt,
  }
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

async function getPaddlePlanChangeContext(targetPlan: PaidPlanKey, targetInterval?: BillingInterval) {
  const membership = await requireCurrentWorkspaceOwner()
  const subscription = await getCurrentBillingSubscription(membership.workspace_id)
  const providerState = await getAuthoritativePaddleState(subscription)
  const environment = getBillingEnvironment()
  const currentInterval = providerState.mapping?.billing_interval || (isBillingInterval(subscription.billing_interval || "") ? subscription.billing_interval as BillingInterval : null)
  const interval = targetInterval || currentInterval || "month"
  const mapping = await getActivePaddlePrice(targetPlan, environment, interval, providerState.mapping?.currency || subscription.billing_currency || "USD")
  if (!mapping) throw new Error(`Paddle ${environment} ${interval} price mapping is not configured for plan ${targetPlan}.`)
  if (providerState.subscription.scheduledChange?.action === "cancel" || subscription.cancel_at_period_end) throw new Error("Reactivate the subscription before changing its plan.")
  if (subscription.plan_key === targetPlan && currentInterval === interval) throw new Error("The workspace is already on that plan and billing cycle.")
  return { membership, subscription, environment, mapping, interval, providerState, currentPeriodEndAt: providerPeriodEnd(providerState, subscription) }
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
      getWorkspaceUsage(membership.workspace_id),
      getCurrentBillingSubscription(membership.workspace_id),
      supabase.from("plans").select("key, name, sort_order, active, features, limits, metadata").eq("active", true).order("sort_order"),
    ])
    if (workspaceError || !workspace) return { success: false, message: "Workspace could not be loaded." }
    if (plans.error) throw new Error(plans.error.message)
    let configuredPrices: Array<{ planKey: string; interval: string; currency: string; providerPriceId: string; amount: string | null }> = []
    try {
      const environment = getBillingEnvironment()
      const mappings = await supabase.from("billing_provider_prices").select("plan_key, billing_interval, currency, provider_price_id").eq("provider", "paddle").eq("environment", environment).eq("active", true)
      if (mappings.error) throw new Error(mappings.error.message)
      const paddle = getPaddleServerClient()
      configuredPrices = await Promise.all((mappings.data || []).map(async (row) => {
        try {
          const price = await paddle.prices.get(row.provider_price_id)
          return { planKey: row.plan_key, interval: row.billing_interval, currency: row.currency, providerPriceId: row.provider_price_id, amount: price.unitPrice.amount }
        } catch {
          return { planKey: row.plan_key, interval: row.billing_interval, currency: row.currency, providerPriceId: row.provider_price_id, amount: null }
        }
      }))
    } catch { configuredPrices = [] }
    const billingPresentation = getBillingPresentation()
    let authoritativeState: AuthoritativePaddleState | null = null
    if (subscription.provider === "paddle" && subscription.provider_subscription_id && billingPresentation.paddleConfigured) {
      try { authoritativeState = await getAuthoritativePaddleState(subscription) } catch { authoritativeState = null }
    }
    const authoritativePriceId = authoritativeState?.subscription.items?.[0]?.price?.id || subscription.provider_price_id
    const authoritativeMapping = authoritativeState?.mapping
    const hasPendingPlanChange = Boolean(subscription.scheduled_plan_key && (subscription.scheduled_effective_at || subscription.scheduled_plan_at))
    let currentPriceId = hasPendingPlanChange ? subscription.provider_price_id : authoritativePriceId
    let currentPriceMapping = authoritativeMapping
    if (hasPendingPlanChange) {
      const currentInterval = subscription.billing_interval || subscription.scheduled_plan_interval || authoritativeMapping?.billing_interval
      if (isPaidPlanKey(subscription.plan_key) && currentInterval && isBillingInterval(currentInterval)) {
        try {
          currentPriceMapping = await getActivePaddlePrice(subscription.plan_key, getBillingEnvironment(), currentInterval, subscription.billing_currency || authoritativeMapping?.currency || "USD")
          currentPriceId = currentPriceMapping?.provider_price_id || currentPriceId
        } catch { currentPriceMapping = authoritativeMapping }
      }
      if (currentPriceId && currentPriceId !== authoritativePriceId && currentPriceMapping === authoritativeMapping) {
        try { currentPriceMapping = await getPaddlePriceByProviderId(currentPriceId, getBillingEnvironment(), false) } catch { currentPriceMapping = authoritativeMapping }
      }
    }
    const resolvedBillingInterval = currentPriceMapping?.billing_interval || subscription.billing_interval
    const resolvedBillingCurrency = currentPriceMapping?.currency || subscription.billing_currency || "USD"
    let currentProviderPriceAmount: string | null = null
    if (currentPriceId && billingPresentation.paddleConfigured) {
      try {
        const currentPaddlePrice = await getPaddleServerClient().prices.get(currentPriceId)
        currentProviderPriceAmount = currentPaddlePrice.unitPrice.amount
      } catch { currentProviderPriceAmount = null }
    }
    const resolvedStatus = authoritativeState?.subscription.status || subscription.provider_status
    const resolvedCurrentPeriodStart = authoritativeState?.subscription.currentBillingPeriod?.startsAt || subscription.current_period_start_at || subscription.current_period_start
    const resolvedCurrentPeriodEnd = authoritativeState?.subscription.currentBillingPeriod?.endsAt || subscription.current_period_end_at || subscription.current_period_end
    const resolvedNextBilledAt = authoritativeState?.subscription.nextBilledAt || subscription.next_billed_at
    const resolvedScheduledChange = authoritativeState?.subscription.scheduledChange
    let paymentMethod: { type: string; last4: string | null; expiryMonth: number | null; expiryYear: number | null } | null = null
    if (subscription.provider === "paddle" && subscription.provider_customer_id && billingPresentation.paddleConfigured) {
      try {
        const methods = getPaddleServerClient().paymentMethods.list(subscription.provider_customer_id)
        for await (const method of methods) {
          paymentMethod = { type: method.type, last4: method.card?.last4 || null, expiryMonth: method.card?.expiryMonth || null, expiryYear: method.card?.expiryYear || null }
          break
        }
      } catch {
        paymentMethod = null
      }
    }
    return {
      success: true,
      data: {
        workspace,
        entitlements,
        usage,
        billing: {
          canManage: membership.role === "owner",
          paddleConfigured: billingPresentation.paddleConfigured,
          environment: subscription.provider_environment || billingPresentation.environment,
          provider: subscription.provider,
          customerId: subscription.provider_customer_id,
          subscriptionId: subscription.provider_subscription_id,
          providerStatus: resolvedStatus,
          currentPeriodStart: resolvedCurrentPeriodStart,
          currentPeriodEnd: resolvedCurrentPeriodEnd,
          nextBilledAt: resolvedNextBilledAt,
          cancelAtPeriodEnd: resolvedScheduledChange?.action === "cancel" || subscription.cancel_at_period_end,
          scheduledChangeAt: resolvedScheduledChange?.effectiveAt || subscription.scheduled_effective_at || subscription.scheduled_change_at || resolvedCurrentPeriodEnd,
          scheduledChangeAction: resolvedScheduledChange?.action || subscription.scheduled_change_action,
          scheduledPlanKey: subscription.scheduled_plan_key,
          scheduledPlanAt: subscription.scheduled_effective_at || subscription.scheduled_plan_at,
          scheduledPlanInterval: subscription.scheduled_plan_interval,
          billingInterval: resolvedBillingInterval,
          billingCurrency: resolvedBillingCurrency,
          currentProviderPriceId: currentPriceId,
          currentProviderPriceAmount,
          billingIssueCode: subscription.billing_issue_code || (resolvedStatus === "past_due" ? "past_due" : null),
          paymentFailureStartedAt: subscription.payment_failure_started_at,
          paymentGraceEndsAt: subscription.payment_grace_ends_at,
          paymentMethod,
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

export async function reconcilePaddleSubscription() {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== "paddle" || !subscription.provider_subscription_id) return { success: false, message: "No active Paddle subscription is available." }
    const { authoritative, result } = await reconcilePaddleSubscriptionProjection(subscription)
    revalidatePath("/manage/plan")
    return {
      success: true,
      data: {
        status: authoritative.subscription.status,
        priceId: authoritative.subscription.items[0]?.price?.id || null,
        syncStatus: result.status,
      },
    }
  } catch (error) {
    return { success: false, message: friendlyBillingError(error) }
  }
}

export async function previewPaddleCheckout(targetPlan: string, billingInterval: string = "month") {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const resolvedTargetPlan = targetPlan?.trim() || await getConfiguredDefaultPlanKey()
    if (!isPaidPlanKey(resolvedTargetPlan) || !isBillingInterval(billingInterval)) return { success: false, message: "That plan or billing cycle is not available." }
    const environment = getBillingEnvironment()
    const mapping = await getActivePaddlePrice(resolvedTargetPlan, environment, billingInterval)
    if (!mapping) return { success: false, message: `Paddle ${environment} ${billingInterval} price mapping is not configured for plan ${resolvedTargetPlan}.` }
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider === "paddle" && subscription.provider_subscription_id && subscription.provider_status !== "canceled") return { success: false, message: "This workspace already has a Paddle subscription. Use Manage plan instead." }
    if (subscription.provider_subscription_id || subscription.source !== "system") await ensureCheckoutEligibility(subscription)
    const preview = await getPaddleServerClient().transactions.preview({ items: [{ priceId: mapping.provider_price_id, quantity: 1 }], ...(subscription.provider_customer_id ? { customerId: subscription.provider_customer_id } : {}) })
    const totals = preview.details.totals
    return { success: true, data: { planKey: resolvedTargetPlan, plan: await getPlanName(resolvedTargetPlan), interval: billingInterval, amount: totals.grandTotal || totals.total, currency: totals.currencyCode, nextRecurringAmount: totals.grandTotal || totals.total, previewedAt: new Date().toISOString() } }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function startPaddleCheckout(targetPlan: string, intervalOrRequestKey?: string, requestKey?: string) {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const resolvedTargetPlan = targetPlan?.trim() || await getConfiguredDefaultPlanKey()
    const billingInterval = isBillingInterval(intervalOrRequestKey || "") ? intervalOrRequestKey as BillingInterval : "month"
    const actualRequestKey = isBillingInterval(intervalOrRequestKey || "") ? requestKey : intervalOrRequestKey
    if (!isPaidPlanKey(resolvedTargetPlan)) return { success: false, message: "That plan is not available." }
    const environment = getBillingEnvironment()
    const mapping = await getActivePaddlePrice(resolvedTargetPlan, environment, billingInterval)
    const publicConfig = getPublicPaddleConfig()
    if (!mapping || !publicConfig) return { success: false, message: `Paddle ${environment} price mapping is not configured for plan ${resolvedTargetPlan}.` }
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider === "paddle" && subscription.provider_subscription_id && subscription.provider_status !== "canceled") return { success: false, message: "This workspace already has a Paddle subscription. Use Change plan instead." }
    if (subscription.provider_subscription_id || subscription.source !== "system") await ensureCheckoutEligibility(subscription)
    const idempotencyKey = normalizeRequestKey(actualRequestKey)
    const mutation = await beginBillingMutation(membership.workspace_id, idempotencyKey, "checkout")
    if (mutation.status === "succeeded") {
      const saved = resultRecord(mutation.result)
      if (typeof saved.transactionId === "string") return { success: true, data: { transactionId: saved.transactionId, ...publicConfig } }
    }
    const existing = await createServiceRoleClient().from("billing_checkout_sessions").select("provider_transaction_id, status").eq("workspace_id", membership.workspace_id).eq("idempotency_key", idempotencyKey).maybeSingle()
    if (existing.data?.provider_transaction_id) return { success: true, data: { transactionId: existing.data.provider_transaction_id, ...publicConfig } }
    if (!mutation.created && mutation.status === "pending") return { success: false, message: "Checkout is already being created. Refresh in a moment to continue." }
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, environment, "checkout", null, resolvedTargetPlan)
    let transaction: Awaited<ReturnType<ReturnType<typeof getPaddleServerClient>["transactions"]["create"]>>
    try {
      transaction = await getPaddleServerClient(idempotencyKey).transactions.create({
        items: [{ priceId: mapping.provider_price_id, quantity: 1 }],
        ...(subscription.provider_customer_id ? { customerId: subscription.provider_customer_id } : {}),
        customData: { saas_core_workspace_id: membership.workspace_id, saas_core_target_plan: resolvedTargetPlan, saas_core_billing_interval: billingInterval, saas_core_billing_environment: environment },
      })
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "checkout")
      throw error
    }
    try {
      const supabase = createServiceRoleClient()
      const checkoutError = await supabase.from("billing_checkout_sessions").insert({ workspace_id: membership.workspace_id, environment, target_plan_key: resolvedTargetPlan, provider_price_id: mapping.provider_price_id, provider_transaction_id: transaction.id, idempotency_key: idempotencyKey, status: "created" }).then((result) => result.error)
      if (checkoutError && checkoutError.code !== "23505") throw new Error(checkoutError.message)
      await finishCanonicalTransition(transition.transition_id, "succeeded", { providerReference: transaction.id, transactionId: transaction.id })
      await finishBillingMutation(mutation.id, "succeeded", { transactionId: transaction.id, planKey: resolvedTargetPlan, interval: billingInterval })
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "checkout_persistence")
      throw error
    }
    return { success: true, data: { transactionId: transaction.id, ...publicConfig } }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function createPaddlePortalSession(kind: "overview" | "payment_method" | "cancel" = "overview") {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== "paddle" || !subscription.provider_customer_id || !subscription.provider_subscription_id) return { success: false, message: "No active Paddle billing account is available." }
    const portal = await getPaddleServerClient().customerPortalSessions.create(subscription.provider_customer_id, [subscription.provider_subscription_id])
    if (kind === "overview") return { success: true, url: portal.urls.general.overview }
    const subscriptionUrl = portal.urls.subscriptions.find((item) => item.id === subscription.provider_subscription_id)
    return { success: true, url: (kind === "payment_method" ? subscriptionUrl?.updateSubscriptionPaymentMethod : subscriptionUrl?.cancelSubscription) || portal.urls.general.overview }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function previewPaddlePlanChange(targetPlan: string, targetInterval?: string) {
  try {
    if (!isPaidPlanKey(targetPlan)) return { success: false, message: "That plan is not available." }
    if (targetInterval && !isBillingInterval(targetInterval)) return { success: false, message: "That billing cycle is not available." }
    const { subscription, mapping, interval, providerState } = await getPaddlePlanChangeContext(targetPlan as PaidPlanKey, targetInterval as BillingInterval | undefined)
    const currentOrder = await getPlanSortOrder(subscription.plan_key)
    const targetOrder = await getPlanSortOrder(targetPlan)
    const isDowngrade = targetOrder < currentOrder
    const prorationBillingMode = isDowngrade ? "do_not_bill" : "prorated_immediately"
    const preview = await getPaddleServerClient().subscriptions.previewUpdate(subscription.provider_subscription_id as string, { items: [{ priceId: mapping.provider_price_id, quantity: 1 }], prorationBillingMode })
    const effectiveAt = isDowngrade ? providerPeriodEnd(providerState, subscription) : preview.nextBilledAt
    const data = await subscriptionPreviewData(preview, targetPlan as PaidPlanKey, interval, prorationBillingMode, isDowngrade, effectiveAt, mapping)
    const previewToken = crypto.randomUUID()
    const { error } = await createServiceRoleClient().from("billing_mutations").insert({ workspace_id: subscription.workspace_id, request_key: previewToken, operation: "plan_change", status: "succeeded", fingerprint: `${subscription.provider_subscription_id}:${subscription.provider_price_id}:${mapping.provider_price_id}:${subscription.last_provider_event_at || "none"}`, result: asJson({ ...data, previewToken, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() }) })
    if (error) throw new Error(error.message)
    return { success: true, data: { ...data, previewToken } }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function changePaddlePlan(targetPlan: string, previewToken?: string, requestKey?: string, targetInterval?: string) {
  try {
    if (!isPaidPlanKey(targetPlan)) return { success: false, message: "That plan is not available." }
    const membership = await requireCurrentWorkspaceOwner()
    let preview = previewToken ? await createServiceRoleClient().from("billing_mutations").select("id, status, result, error_code").eq("workspace_id", membership.workspace_id).eq("request_key", previewToken).eq("operation", "plan_change").maybeSingle() : null
    if (!previewToken || preview?.error || !preview?.data) {
      const generated = await previewPaddlePlanChange(targetPlan, targetInterval)
      if (!generated.success || !generated.data) return generated
      previewToken = generated.data.previewToken
      preview = await createServiceRoleClient().from("billing_mutations").select("id, status, result, error_code").eq("workspace_id", membership.workspace_id).eq("request_key", previewToken).eq("operation", "plan_change").maybeSingle()
    }
    const stored = preview?.data
    const saved = stored ? resultRecord(stored.result) : {}
    const expiresAt = typeof saved.expiresAt === "string" ? saved.expiresAt : ""
    if (!stored || stored.status !== "succeeded" || !expiresAt || expiresAt <= new Date().toISOString() || saved.planKey !== targetPlan) return { success: false, message: "This billing preview has expired. Review the current amount again." }
    const operationKey = normalizeRequestKey(requestKey)
    const mutation = await beginBillingMutation(membership.workspace_id, operationKey, "plan_change")
    if (mutation.status === "succeeded") return { success: true, message: "Your billing change is already being synchronized." }
    if (!mutation.created) return { success: false, message: "Another billing change is already being processed. Refresh in a moment to see its result." }
    const interval = typeof saved.interval === "string" && isBillingInterval(saved.interval) ? saved.interval : (targetInterval && isBillingInterval(targetInterval) ? targetInterval : undefined)
    const context = await getPaddlePlanChangeContext(targetPlan as PaidPlanKey, interval)
    const currentOrder = await getPlanSortOrder(context.subscription.plan_key)
    const targetOrder = await getPlanSortOrder(targetPlan)
    const isDowngrade = targetOrder < currentOrder
    const mode = isDowngrade ? "do_not_bill" : "prorated_immediately"
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, context.environment, isDowngrade ? "downgrade" : "upgrade", context.subscription.plan_key, targetPlan, isDowngrade ? context.currentPeriodEndAt : null)
    let freshPreview: Awaited<ReturnType<ReturnType<typeof getPaddleServerClient>["subscriptions"]["previewUpdate"]>>
    try {
      freshPreview = await getPaddleServerClient().subscriptions.previewUpdate(context.subscription.provider_subscription_id as string, { items: [{ priceId: context.mapping.provider_price_id, quantity: 1 }], prorationBillingMode: mode })
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "plan_change_preview")
      throw error
    }
    const fresh = await subscriptionPreviewData(freshPreview, targetPlan as PaidPlanKey, context.interval, mode, isDowngrade, isDowngrade ? context.subscription.current_period_end_at || context.subscription.current_period_end : freshPreview.nextBilledAt, context.mapping)
    if (fresh.amount !== saved.amount || fresh.action !== saved.action || fresh.recurringAmount !== saved.recurringAmount || fresh.creditToBalance !== saved.creditToBalance || fresh.currency !== saved.currency) {
      await finishBillingMutation(mutation.id, "failed", {}, "PREVIEW_CHANGED")
      await finishCanonicalTransition(transition.transition_id, "failed", { reason: "PREVIEW_CHANGED" }, "PREVIEW_CHANGED")
      return { success: false, message: "The billing amount changed. Review the new preview before confirming." }
    }
    const scheduledEffectiveAt = isDowngrade ? context.currentPeriodEndAt : null
    // Persist the entitlement guard before calling Paddle. A webhook can arrive
    // before this request returns, and must not revoke access early.
    if (isDowngrade) {
      const { error: scheduleError } = await createServiceRoleClient().from("workspace_subscriptions").update({
        scheduled_plan_key: targetPlan,
        scheduled_plan_at: scheduledEffectiveAt?.slice(0, 10) || null,
        scheduled_effective_at: scheduledEffectiveAt,
        scheduled_plan_interval: context.interval,
        scheduled_provider_price_id: context.mapping.provider_price_id,
      }).eq("workspace_id", membership.workspace_id)
      if (scheduleError) throw new Error(scheduleError.message)
    }
    let providerResult: Awaited<ReturnType<ReturnType<typeof getPaddleServerClient>["subscriptions"]["update"]>>
    try {
      providerResult = await getPaddleServerClient(operationKey).subscriptions.update(context.subscription.provider_subscription_id as string, { items: [{ priceId: context.mapping.provider_price_id, quantity: 1 }], prorationBillingMode: mode, onPaymentFailure: "prevent_change" })
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "plan_change")
      throw error
    }
    const effectiveAt = scheduledEffectiveAt || providerResult.nextBilledAt
    try {
      const { error: projectionError } = await createServiceRoleClient().from("workspace_subscriptions").update({
        scheduled_plan_key: isDowngrade ? targetPlan : null,
        scheduled_plan_at: isDowngrade ? (effectiveAt || context.subscription.current_period_end)?.slice(0, 10) || null : null,
        scheduled_effective_at: isDowngrade ? effectiveAt : null,
        scheduled_plan_interval: isDowngrade ? context.interval : null,
        scheduled_provider_price_id: isDowngrade ? context.mapping.provider_price_id : null,
      }).eq("workspace_id", membership.workspace_id)
      if (projectionError) throw new Error(projectionError.message)
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "plan_change_persistence")
      throw error
    }
    try {
      await reconcilePaddleSubscriptionProjection(context.subscription)
    } catch {
      // Paddle remains authoritative; the polling reconciliation path will retry
      // the local projection without turning a successful provider mutation into
      // a false billing failure.
    }
    await finishCanonicalTransition(transition.transition_id, "succeeded", { targetPlan, interval: context.interval, effectiveAt, providerReference: providerResult.id || null })
    await finishBillingMutation(mutation.id, "succeeded", { targetPlan, interval: context.interval, effectiveAt })
    revalidatePath("/manage/plan")
    return { success: true, message: isDowngrade ? "Your downgrade is scheduled for the end of the current billing period." : "Your plan change was submitted and will unlock after Paddle confirmation." }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function undoPaddlePlanChange(requestKey?: string) {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (!subscription.scheduled_plan_key || !isPaidPlanKey(subscription.plan_key)) return { success: false, message: "There is no pending plan change to undo." }
    const environment = getBillingEnvironment()
    const providerState = await getAuthoritativePaddleState(subscription)
    const interval = providerState.mapping?.billing_interval || (isBillingInterval(subscription.billing_interval || "") ? subscription.billing_interval as BillingInterval : "month")
    const mapping = await getActivePaddlePrice(subscription.plan_key as PaidPlanKey, environment, interval, providerState.mapping?.currency || subscription.billing_currency || "USD")
    if (!mapping || !subscription.provider_subscription_id) return { success: false, message: "The current plan price mapping is not configured." }
    const mutation = await beginBillingMutation(membership.workspace_id, normalizeRequestKey(requestKey), "plan_change")
    if (mutation.status === "succeeded") return { success: true, message: "The pending change is already being undone." }
    if (!mutation.created) return { success: false, message: "Another billing change is already being processed. Refresh in a moment to see its result." }
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, environment, "downgrade", subscription.scheduled_plan_key, subscription.plan_key, null)
    const paddle = getPaddleServerClient()
    let preview: Awaited<ReturnType<ReturnType<typeof getPaddleServerClient>["subscriptions"]["previewUpdate"]>>
    try {
      preview = await paddle.subscriptions.previewUpdate(subscription.provider_subscription_id, { items: [{ priceId: mapping.provider_price_id, quantity: 1 }], prorationBillingMode: "do_not_bill" })
      await paddle.subscriptions.update(subscription.provider_subscription_id, { items: [{ priceId: mapping.provider_price_id, quantity: 1 }], prorationBillingMode: "do_not_bill", onPaymentFailure: "prevent_change" })
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "undo_plan_change")
      throw error
    }
    try {
      const { error: projectionError } = await createServiceRoleClient().from("workspace_subscriptions").update({ scheduled_plan_key: null, scheduled_plan_at: null, scheduled_effective_at: null, scheduled_plan_interval: null, scheduled_provider_price_id: null }).eq("workspace_id", membership.workspace_id)
      if (projectionError) throw new Error(projectionError.message)
      await finishCanonicalTransition(transition.transition_id, "succeeded", { amount: preview.updateSummary?.result.amount || null })
      await finishBillingMutation(mutation.id, "succeeded", { amount: preview.updateSummary?.result.amount || null })
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "undo_plan_change_persistence")
      throw error
    }
    revalidatePath("/manage/plan")
    return { success: true, message: "The pending plan change was undone." }
  } catch (error) { return { success: false, message: friendlyBillingError(error) }
  }
}

export async function cancelPaddleSubscription(reasonCode = "other", feedback = "", requestKey?: string) {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    if (!CANCELLATION_REASONS.has(reasonCode)) return { success: false, message: "Please choose a cancellation reason." }
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== "paddle" || !subscription.provider_subscription_id) return { success: false, message: "No active Paddle subscription is available." }
    const providerState = await getAuthoritativePaddleState(subscription)
    if (subscription.scheduled_plan_key || (providerState.subscription.scheduledChange && providerState.subscription.scheduledChange.action !== "cancel")) return { success: false, message: "Undo the pending plan change before scheduling cancellation." }
    const mutation = await beginBillingMutation(membership.workspace_id, normalizeRequestKey(requestKey), "cancel")
    if (mutation.status === "succeeded") return { success: true, message: "Cancellation is already scheduled." }
    if (!mutation.created) return { success: false, message: "Another billing change is already being processed. Refresh in a moment to see its result." }
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, getBillingEnvironment(), "cancel", subscription.plan_key, subscription.plan_key, providerPeriodEnd(providerState, subscription))
    await createServiceRoleClient().from("billing_cancellation_feedback").insert({ workspace_id: membership.workspace_id, provider_subscription_id: subscription.provider_subscription_id, reason_code: reasonCode, feedback: feedback.trim().slice(0, 1000) || null })
    let result: Awaited<ReturnType<ReturnType<typeof getPaddleServerClient>["subscriptions"]["cancel"]>>
    try {
      result = await getPaddleServerClient().subscriptions.cancel(subscription.provider_subscription_id, { effectiveFrom: "next_billing_period" })
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "cancel")
      throw error
    }
    await finishCanonicalTransition(transition.transition_id, "succeeded", { effectiveAt: result.scheduledChange?.effectiveAt || providerPeriodEnd(providerState, subscription) })
    await finishBillingMutation(mutation.id, "succeeded", { effectiveAt: result.scheduledChange?.effectiveAt || providerPeriodEnd(providerState, subscription) })
    revalidatePath("/manage/plan")
    return { success: true, message: "Cancellation scheduled for the end of the current billing period." }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function resumePaddleSubscription(requestKey?: string) {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== "paddle" || !subscription.provider_subscription_id) return { success: false, message: "No active Paddle subscription is available." }
    await getAuthoritativePaddleState(subscription)
    const mutation = await beginBillingMutation(membership.workspace_id, normalizeRequestKey(requestKey), "resume")
    if (mutation.status === "succeeded") return { success: true, message: "Your subscription is already being reactivated." }
    if (!mutation.created) return { success: false, message: "Another billing change is already being processed. Refresh in a moment to see its result." }
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, getBillingEnvironment(), "resume", subscription.plan_key, subscription.plan_key, null)
    // Paddle's resume endpoint is for paused subscriptions only. A cancellation
    // scheduled for the next billing period is removed by explicitly clearing
    // scheduled_change, which does not create a new charge.
    try {
      await getPaddleServerClient().subscriptions.update(subscription.provider_subscription_id, {
        scheduledChange: null,
      })
      const { error: clearError } = await createServiceRoleClient().from("workspace_subscriptions").update({
        cancel_at_period_end: false,
        scheduled_change_at: null,
        scheduled_change_action: null,
        scheduled_effective_at: null,
      }).eq("workspace_id", membership.workspace_id)
      if (clearError) throw new Error(clearError.message)
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "resume")
      throw error
    }
    await finishCanonicalTransition(transition.transition_id, "succeeded", {})
    await finishBillingMutation(mutation.id, "succeeded", {})
    revalidatePath("/manage/plan")
    return { success: true, message: "Your subscription has been reactivated." }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function startPaymentMethodRecovery(requestKey?: string) {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== "paddle" || !subscription.provider_subscription_id) return { success: false, message: "No active Paddle subscription is available." }
    const config = getPublicPaddleConfig()
    if (!config) return { success: false, message: "Billing checkout is not configured." }
    const environment = getBillingEnvironment()
    const mutation = await beginBillingMutation(membership.workspace_id, normalizeRequestKey(requestKey), "payment_recovery")
    if (mutation.status === "succeeded") {
      const saved = resultRecord(mutation.result)
      if (typeof saved.transactionId === "string") return { success: true, data: { transactionId: saved.transactionId, ...config } }
    }
    if (!mutation.created) return { success: false, message: "Payment recovery is already being started. Refresh in a moment to continue." }
    const transition = await beginCanonicalTransition(mutation, membership.workspace_id, environment, "recovery", subscription.plan_key, subscription.plan_key, null)
    let transaction: Awaited<ReturnType<ReturnType<typeof getPaddleServerClient>["subscriptions"]["getPaymentMethodChangeTransaction"]>>
    try {
      transaction = await getPaddleServerClient().subscriptions.getPaymentMethodChangeTransaction(subscription.provider_subscription_id)
    } catch (error) {
      await persistUnknownProviderOutcome(mutation, transition.transition_id, error, "payment_recovery")
      throw error
    }
    await finishCanonicalTransition(transition.transition_id, "succeeded", { providerReference: transaction.id, transactionId: transaction.id })
    await finishBillingMutation(mutation.id, "succeeded", { transactionId: transaction.id })
    return { success: true, data: { transactionId: transaction.id, ...config } }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function getBillingTransactions() {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== "paddle" || !subscription.provider_customer_id) return { success: true, data: [] }
    const collection = getPaddleServerClient().transactions.list({ customerId: [subscription.provider_customer_id], ...(subscription.provider_subscription_id ? { subscriptionId: [subscription.provider_subscription_id] } : {}), perPage: 50 })
    const rows: Array<Record<string, string | null>> = []
    for await (const transaction of collection) rows.push({ id: transaction.id, date: transaction.billedAt || transaction.createdAt, status: transaction.status, amount: transaction.details?.totals?.grandTotal || transaction.details?.totals?.total || null, currency: transaction.currencyCode, invoiceNumber: transaction.invoiceNumber, invoiceId: transaction.invoiceId })
    return { success: true, data: rows }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}

export async function getBillingInvoiceUrl(transactionId: string) {
  try {
    const membership = await requireCurrentWorkspaceOwner()
    const subscription = await getCurrentBillingSubscription(membership.workspace_id)
    if (subscription.provider !== "paddle" || !subscription.provider_customer_id || !transactionId.trim()) return { success: false, message: "Invoice is not available." }
    const paddle = getPaddleServerClient()
    const transaction = await paddle.transactions.get(transactionId.trim())
    if (transaction.customerId !== subscription.provider_customer_id || (subscription.provider_subscription_id && transaction.subscriptionId && transaction.subscriptionId !== subscription.provider_subscription_id)) return { success: false, message: "Invoice is not available." }
    try {
      const invoice = await paddle.transactions.getInvoicePDF(transaction.id, { disposition: "inline" })
      if (invoice.url) return { success: true, url: invoice.url }
    } catch {
      // Some Sandbox transactions do not expose a PDF immediately. Keep the
      // customer in Paddle's authenticated portal instead of opening a blank
      // or fabricated invoice URL.
    }
    const portal = await paddle.customerPortalSessions.create(subscription.provider_customer_id, [subscription.provider_subscription_id as string])
    return { success: true, url: portal.urls.general.overview }
  } catch (error) { return { success: false, message: friendlyBillingError(error) } }
}
