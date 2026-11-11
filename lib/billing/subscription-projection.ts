import "server-only"

import { randomUUID } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { getProviderPriceByProviderId, isPaidPlanKey, type ProviderPriceMapping } from "./price-mapping"
import { getConfiguredFallbackPlanKey, isTerminalBillingSubscription, projectCanonicalSubscription, type CanonicalSubscription } from "./reconciliation"
import { upsertBillingProviderAccount, updateBillingMutationTransition } from "./persistence"
import { deferredIntervalResumeRequestKey, type BillingProviderAdapter, type ProviderCheckoutSession, type ProviderSubscriptionSnapshot } from "./provider"

export class BillingProjectionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "BillingProjectionError"
    this.code = code
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function uuidValue(value: unknown) {
  const text = stringValue(value)
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null
}

export function isInitialSubscriptionSourceEligible(source: string | null | undefined) {
  return source === "system" || source === "provider" || source === "trial"
}

function canonicalSubscription(snapshot: ProviderSubscriptionSnapshot): CanonicalSubscription {
  return {
    id: snapshot.id,
    status: snapshot.status,
    customerId: snapshot.customerId,
    nextBilledAt: snapshot.nextBilledAt,
    currentBillingPeriod: snapshot.currentBillingPeriod,
    scheduledChange: snapshot.cancelAtPeriodEnd && snapshot.cancelEffectiveAt
      ? { action: "cancel", effectiveAt: snapshot.cancelEffectiveAt, resumeAt: null }
      : null,
    customData: snapshot.customData,
    items: snapshot.items,
  }
}

function maxEventMarker(currentAt: string | null, currentId: string | null, incomingAt: string, incomingId: string) {
  if (!currentAt || new Date(incomingAt).getTime() > new Date(currentAt).getTime()) return { at: incomingAt, id: incomingId }
  if (new Date(incomingAt).getTime() < new Date(currentAt).getTime()) return { at: currentAt, id: currentId || incomingId }
  return { at: currentAt, id: currentId && currentId > incomingId ? currentId : incomingId }
}

export async function claimWorkspaceProjection(db: any, workspaceId: string, leaseSeconds = 30) {
  const leaseToken = randomUUID()
  const { data, error } = await db.rpc("claim_billing_projection", {
    p_workspace_id: workspaceId,
    p_lease_token: leaseToken,
    p_lease_seconds: leaseSeconds,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row.lease_revision !== "number") {
    throw new BillingProjectionError("PROJECTION_BUSY", "Workspace billing is being reconciled by another worker.")
  }
  return { leaseToken, revision: row.lease_revision as number }
}

export async function releaseWorkspaceProjection(db: any, workspaceId: string, leaseToken: string, revision: number) {
  const { error } = await db.rpc("release_billing_projection", {
    p_workspace_id: workspaceId,
    p_lease_token: leaseToken,
    p_lease_revision: revision,
  })
  if (error) throw new Error(error.message)
}

async function validateInitialCheckoutCorrelation(
  db: any,
  input: { workspaceId: string; provider: string; environment: "sandbox" | "live"; mutationId: string; planKey: string; priceId: string; interval: string },
  subscription: ProviderSubscriptionSnapshot,
  retrieveCheckoutSession: BillingProviderAdapter["retrieveCheckoutSession"],
  verifiedCheckout?: ProviderCheckoutSession,
) {
  const { data: mutation, error: mutationError } = await db.from("billing_mutations")
    .select("id, operation, status")
    .eq("id", input.mutationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle()
  if (mutationError) throw new Error(mutationError.message)
  if (!mutation || mutation.operation !== "checkout" || !["pending", "succeeded", "unknown"].includes(mutation.status)) {
    throw new BillingProjectionError("CHECKOUT_MUTATION_MISMATCH", "Billing subscription is not linked to a valid checkout mutation.")
  }
  const { data: checkout, error: checkoutError } = await db.from("billing_checkout_sessions")
    .select("target_plan_key, provider_price_id, provider_transaction_id, status")
    .eq("provider", input.provider)
    .eq("environment", input.environment)
    .eq("workspace_id", input.workspaceId)
    .eq("idempotency_key", input.mutationId)
    .maybeSingle()
  if (checkoutError) throw new Error(checkoutError.message)
  if (!checkout?.provider_transaction_id || checkout.target_plan_key !== input.planKey || checkout.provider_price_id !== input.priceId || checkout.status === "failed" || checkout.status === "expired") {
    throw new BillingProjectionError("CHECKOUT_CORRELATION_MISMATCH", "Billing subscription does not match the recorded checkout request.")
  }
  const session = verifiedCheckout ?? await retrieveCheckoutSession(checkout.provider_transaction_id)
  if (session.id !== checkout.provider_transaction_id || session.status !== "complete" ||
      (session.paymentStatus !== "paid" && !(input.provider === "stripe" && session.paymentStatus === "no_payment_required")) ||
      !session.customerId || session.customerId !== subscription.customerId || session.subscriptionId !== subscription.id ||
      session.workspaceId !== input.workspaceId || session.mutationId !== input.mutationId ||
      session.livemode !== (input.environment === "live") ||
      session.metadata.billing_provider !== input.provider || session.metadata.billing_environment !== input.environment ||
      session.metadata.plan_key !== input.planKey || session.metadata.billing_interval !== input.interval) {
    throw new BillingProjectionError("CHECKOUT_PAYMENT_UNVERIFIED", "The recorded checkout has not verified payment for this subscription and customer.")
  }
}

export async function applyProviderSubscriptionProjection(
  event: { eventId: string; occurredAt: string; workspaceId: string | null; eventType: string },
  subscriptionId: string,
  adapter: Pick<BillingProviderAdapter, "provider" | "environment" | "retrieveSubscription" | "retrieveCheckoutSession" | "hasPaidRenewal">,
  verifiedCheckout?: ProviderCheckoutSession,
) {
  const { provider, environment } = adapter
  const db = createServiceRoleClient() as any
  const { data: linked, error: linkedError } = await db.from("workspace_subscriptions")
    .select("workspace_id")
    .eq("provider", provider)
    .eq("provider_environment", environment)
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle()
  if (linkedError) throw new Error(linkedError.message)
  const metadataWorkspaceId = uuidValue(event.workspaceId)
  const workspaceId = stringValue(linked?.workspace_id) || metadataWorkspaceId
  if (!workspaceId) throw new BillingProjectionError("UNKNOWN_WORKSPACE", "Billing subscription is not linked to a workspace.")
  if (linked?.workspace_id && metadataWorkspaceId && linked.workspace_id !== metadataWorkspaceId) {
    throw new BillingProjectionError("WORKSPACE_MISMATCH", "Billing subscription metadata conflicts with its existing workspace link.")
  }

  const lease = await claimWorkspaceProjection(db, workspaceId)
  let committed = false
  try {
    const { data: current, error: currentError } = await db.from("workspace_subscriptions")
      .select("workspace_id, plan_key, status, source, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_price_id, provider_status, billing_interval, billing_currency, current_period_start, current_period_end, current_period_start_at, current_period_end_at, cancel_at_period_end, scheduled_change_at, scheduled_change_action, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, scheduled_plan_interval, scheduled_provider_price_id, last_provider_event_at, last_provider_event_id, payment_failure_started_at, payment_grace_ends_at, billing_issue_code")
      .eq("workspace_id", workspaceId)
      .single()
    if (currentError || !current) throw new Error(currentError?.message || "Workspace subscription does not exist.")

    let subscription = await adapter.retrieveSubscription(subscriptionId)
    if (subscription.id !== subscriptionId) throw new BillingProjectionError("SUBSCRIPTION_LINK_MISMATCH", "Billing provider returned a different subscription.")
    const subscriptionWorkspaceId = subscription.customData.workspace_id || subscription.customData.saas_core_workspace_id
    if (subscriptionWorkspaceId && uuidValue(subscriptionWorkspaceId) !== workspaceId) {
      throw new BillingProjectionError("WORKSPACE_MISMATCH", "Billing subscription metadata conflicts with its workspace link.")
    }
    if (subscription.customData.billing_environment && subscription.customData.billing_environment !== environment) {
      throw new BillingProjectionError("ENVIRONMENT_MISMATCH", "Billing subscription metadata belongs to another billing environment.")
    }
    if (subscription.customData.billing_provider && subscription.customData.billing_provider !== provider) {
      throw new BillingProjectionError("PROVIDER_MISMATCH", "Billing subscription metadata names another billing provider.")
    }
    if (subscription.livemode !== (environment === "live")) {
      throw new BillingProjectionError("ENVIRONMENT_MISMATCH", "Billing subscription belongs to another billing environment.")
    }
    if (subscription.issueCode === "unsupported_subscription_schedule" || subscription.issueCode === "unmanaged_subscription_schedule") {
      throw new BillingProjectionError("UNSUPPORTED_SCHEDULE", "Billing subscription has a schedule this product cannot safely manage.")
    }

    // Provider subscription dates can advance while payment is outstanding.
    // Commit a new paid window only after checking the matching payment.
    const previousEnd = Date.parse(current.current_period_end_at || current.current_period_end || "")
    const providerStart = Date.parse(subscription.currentBillingPeriod?.startsAt || "")
    const providerEnd = Date.parse(subscription.currentBillingPeriod?.endsAt || "")
    const sameSubscription = current.provider_subscription_id === subscriptionId
    const isCollecting = subscription.status === "active" || subscription.status === "past_due"
    const verifiesPeriod = subscription.status === "active" || subscription.status === "trialing" ||
      (adapter.hasPaidRenewal && subscription.status === "past_due")
    if (verifiesPeriod && (!Number.isFinite(providerStart) || !Number.isFinite(providerEnd) || providerEnd <= providerStart)) {
      throw new BillingProjectionError("INVALID_PAID_PERIOD", "Billing provider returned an invalid paid period.")
    }
    if (provider === "paddle" && sameSubscription && verifiesPeriod && previousEnd > Date.now() && providerEnd < previousEnd) {
      throw new BillingProjectionError("INVALID_PAID_PERIOD", "Paddle returned a shorter paid period.")
    }
    const deferred = subscription.deferredIntervalChange
    const resumesDeferredInterval = deferred?.phase === "resumed" && (
      current.status !== "active" || current.provider_price_id !== deferred.targetPriceId ||
      Date.parse(current.current_period_start_at || "") !== providerStart
    )
    const advancesPaidPeriod = sameSubscription && isCollecting &&
      (!Number.isFinite(previousEnd) || providerStart >= previousEnd || providerEnd > previousEnd)
    let deferredPaymentPending = false
    if (adapter.hasPaidRenewal && (advancesPaidPeriod || resumesDeferredInterval) && providerStart > Date.now()) {
      throw new BillingProjectionError("RENEWAL_NOT_EFFECTIVE", "The next billing period has not started.")
    }
    if (adapter.hasPaidRenewal && (advancesPaidPeriod || resumesDeferredInterval) && !await adapter.hasPaidRenewal(subscription)) {
      if (subscription.status !== "past_due") {
        throw new BillingProjectionError("RENEWAL_PENDING_PAYMENT", "The new billing period is awaiting payment.")
      }
      deferredPaymentPending = resumesDeferredInterval
      const previousPrice = current.provider_price_id &&
        await getProviderPriceByProviderId(provider, current.provider_price_id, environment, false)
      if (!previousPrice || !current.current_period_start_at || !current.current_period_end_at) {
        throw new BillingProjectionError("RENEWAL_PRICE_MISSING", "The last paid billing period could not be verified.")
      }
      subscription = {
        ...subscription,
        currentBillingPeriod: { startsAt: current.current_period_start_at, endsAt: current.current_period_end_at },
        items: [{ id: previousPrice.provider_price_id, priceId: previousPrice.provider_price_id, productId: previousPrice.provider_product_id, quantity: 1 }],
      }
    }

    const item = subscription.items[0]
    const priceId = item?.priceId
    if (!priceId) throw new BillingProjectionError("UNKNOWN_PRICE", "Billing subscription does not contain a registered Price.")
    const mapping = await getProviderPriceByProviderId(provider, priceId, environment, false)
    if (!mapping || !isPaidPlanKey(mapping.plan_key)) throw new BillingProjectionError("UNKNOWN_PRICE", "Billing subscription Price is not registered for this environment.")
    const productId = item?.productId
    if (productId && productId !== mapping.provider_product_id) {
      throw new BillingProjectionError("UNKNOWN_PRODUCT", "Billing subscription Product does not match its registered Price.")
    }

    const replacingSubscription = Boolean(current.provider_subscription_id && current.provider_subscription_id !== subscriptionId)
    const oldStatus = current.provider_status || current.status
    if (current.provider_subscription_id === subscriptionId && current.provider && current.provider !== provider) {
      throw new BillingProjectionError("PROVIDER_MISMATCH", "Billing subscription ID conflicts with the Workspace's existing provider link.")
    }
    if (current.provider_subscription_id && (current.provider !== provider || current.provider_environment !== environment)) {
      throw new BillingProjectionError("PROVIDER_SCOPE_MISMATCH", "Workspace subscription belongs to another provider or environment.")
    }
    if (!replacingSubscription && current.provider_subscription_id && current.provider_customer_id !== subscription.customerId) {
      throw new BillingProjectionError("CUSTOMER_MISMATCH", "Billing customer does not match the linked Workspace subscription.")
    }
    if (replacingSubscription && !isTerminalBillingSubscription(oldStatus)) {
      throw new BillingProjectionError("DUPLICATE_PROVIDER_SUBSCRIPTION", "Workspace already has another non-terminal subscription.")
    }
    // A server-granted no-card trial may convert to its first provider subscription.
    // Manual commercial overrides remain ineligible for an initial Billing checkout.
    if (!replacingSubscription && !current.provider_subscription_id && !isInitialSubscriptionSourceEligible(current.source)) {
      throw new BillingProjectionError("WORKSPACE_NOT_BILLING_ELIGIBLE", "Workspace already has a non-provider commercial state.")
    }
    if (replacingSubscription || !current.provider_subscription_id) {
      const mutationId = stringValue(subscription.customData.billing_mutation_id)
      if (!mutationId) throw new BillingProjectionError("CHECKOUT_MUTATION_MISSING", "Initial Billing subscription has no billing mutation reference.")
      await validateInitialCheckoutCorrelation(db, {
        workspaceId,
        provider,
        environment,
        mutationId,
        planKey: mapping.plan_key,
        priceId,
        interval: mapping.billing_interval,
      }, subscription, adapter.retrieveCheckoutSession, verifiedCheckout)
    }

    let scheduledPlan: { mapping: ProviderPriceMapping; effectiveAt: string } | null = null
    if (subscription.scheduledPlan) {
      const targetMapping = await getProviderPriceByProviderId(provider, subscription.scheduledPlan.priceId, environment, false)
      if (!targetMapping || !isPaidPlanKey(targetMapping.plan_key)) {
        throw new BillingProjectionError("UNKNOWN_SCHEDULED_PRICE", "Billing scheduled Price is not registered for this environment.")
      }
      scheduledPlan = { mapping: targetMapping, effectiveAt: subscription.scheduledPlan.effectiveAt }
    }

    const fallbackPlanKey = await getConfiguredFallbackPlanKey(db)
    const projection = projectCanonicalSubscription({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      subscription: canonicalSubscription(subscription),
      mapping,
      scheduledPlan,
      fallbackPlanKey,
      current,
      now: new Date(),
      authoritative: true,
    })
    const eventMarker = maxEventMarker(current.last_provider_event_at, current.last_provider_event_id, event.occurredAt, event.eventId)
    const deferredPause = deferred && (deferred.phase !== "resumed" || deferredPaymentPending) ? deferred.effectiveAt : null
    const patch = {
      plan_key: projection.planKey,
      status: projection.status,
      source: "provider",
      provider,
      provider_environment: environment,
      provider_customer_id: subscription.customerId,
      provider_subscription_id: subscription.id,
      provider_price_id: priceId,
      provider_status: subscription.providerStatus,
      billing_interval: projection.billingInterval,
      billing_currency: projection.billingCurrency,
      current_period_start: projection.currentPeriodStart,
      current_period_end: projection.currentPeriodEnd,
      current_period_start_at: projection.currentPeriodStartAt,
      current_period_end_at: projection.currentPeriodEndAt,
      cancel_at_period_end: subscription.cancelAtPeriodEnd,
      last_provider_event_at: eventMarker.at,
      last_provider_event_id: eventMarker.id,
      next_billed_at: subscription.nextBilledAt,
      scheduled_change_at: subscription.cancelEffectiveAt || deferredPause,
      scheduled_change_action: subscription.cancelAtPeriodEnd ? "cancel" : deferredPause ? "pause" : null,
      scheduled_plan_key: projection.scheduledPlanKey,
      scheduled_plan_at: projection.scheduledPlanAt,
      scheduled_effective_at: projection.scheduledEffectiveAt,
      scheduled_plan_interval: projection.scheduledPlanInterval,
      scheduled_provider_price_id: projection.scheduledProviderPriceId,
      payment_failure_started_at: projection.paymentFailureStartedAt,
      payment_grace_ends_at: projection.paymentGraceEndsAt,
      billing_issue_code: subscription.issueCode || projection.billingIssueCode,
      billing_projection_revision: lease.revision + 1,
      billing_projection_lease_token: null,
      billing_projection_lease_until: null,
    }
    const paidCutover = deferred?.phase === "resumed" && subscription.status === "active"
    const canceledCutover = subscription.status === "canceled" && subscription.customData.billing_schedule_strategy === "pause_then_resume"
    const settledScheduleId = paidCutover ? deferred.scheduleId : canceledCutover ? uuidValue(subscription.customData.billing_schedule_mutation_id) : null
    if (settledScheduleId) {
      // Persist the resume outcome while the projection lease still protects the due marker.
      const { error } = await db.from("billing_mutations")
        .update(paidCutover ? { status: "succeeded", error_code: null } : { status: "failed", error_code: "PADDLE_INTERVAL_CANCELED" })
        .eq("workspace_id", workspaceId).eq("operation", "resume")
        .eq("request_key", deferredIntervalResumeRequestKey(settledScheduleId)).in("status", ["pending", "unknown"])
      if (error) throw new Error(error.message)
    }
    const { data: updated, error: updateError } = await db.from("workspace_subscriptions")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("billing_projection_revision", lease.revision)
      .eq("billing_projection_lease_token", lease.leaseToken)
      .select("workspace_id")
      .maybeSingle()
    if (updateError) throw new Error(updateError.message)
    if (!updated) throw new BillingProjectionError("STALE_PROJECTION_LEASE", "Workspace billing projection lease was replaced before finalization.")
    committed = true

    if (subscription.customerId) {
      await upsertBillingProviderAccount({
        workspaceId,
        provider,
        environment,
        // A Paddle buyer can pay for multiple Workspace subscriptions under one seller.
        providerAccountId: provider === "paddle" ? subscription.id : subscription.customerId,
        providerCustomerId: subscription.customerId,
        metadata: { subscriptionId: subscription.id },
      }, db)
    }
    await settleProviderMutation(
      db,
      { workspaceId, provider, environment },
      subscription.customData.billing_schedule_mutation_id || subscription.customData.billing_mutation_id,
      subscription.status,
      mapping.plan_key,
      subscription.id,
      {
        mutationKind: subscription.customData.billing_schedule_mutation_id
          ? subscription.customData.billing_schedule_mutation_kind
          : subscription.customData.billing_mutation_kind,
        scheduledPlanKey: scheduledPlan?.mapping.plan_key || deferred?.targetPlanKey || null,
        scheduledPlanInterval: scheduledPlan?.mapping.billing_interval || (deferred ? "month" : null),
        scheduledTargetPlanKey: stringValue(subscription.customData.billing_schedule_target_plan_key),
        scheduledTargetInterval: stringValue(subscription.customData.billing_schedule_target_interval),
        expectedPlanKey: stringValue(subscription.customData.plan_key),
        expectedBillingInterval: stringValue(subscription.customData.billing_interval),
        providerBillingInterval: mapping.billing_interval,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        hasPendingUpdate: subscription.hasPendingUpdate,
        pendingUpdateExpired: event.eventType === "customer.subscription.pending_update_expired",
        verifiedDeferredPause: deferred?.phase === "paused",
      },
    )
    return { status: "processed" as const, workspaceId, planKey: projection.planKey, subscriptionStatus: projection.status }
  } finally {
    if (!committed) {
      try { await releaseWorkspaceProjection(db, workspaceId, lease.leaseToken, lease.revision) }
      catch (error) { console.error("Could not release billing projection lease", { workspaceId, message: error instanceof Error ? error.message : String(error) }) }
    }
  }
}

export type ProviderMutationSettlement = { state: "succeeded" | "failed"; errorCode: string | null } | null

export function getProviderMutationSettlement(input: {
  transitionKind: string
  toPlanKey: string | null
  mutationKind?: string
  providerStatus: ProviderSubscriptionSnapshot["status"]
  providerPlanKey: string
  providerBillingInterval?: string | null
  expectedPlanKey?: string | null
  expectedBillingInterval?: string | null
  scheduledPlanKey: string | null
  scheduledPlanInterval?: string | null
  scheduledTargetPlanKey?: string | null
  scheduledTargetInterval?: string | null
  cancelAtPeriodEnd: boolean
  hasPendingUpdate?: boolean
  pendingUpdateExpired?: boolean
  verifiedDeferredPause?: boolean
}): ProviderMutationSettlement {
  const planMatches = !input.toPlanKey || input.toPlanKey === input.providerPlanKey
  const metadataMatches = (!input.expectedPlanKey || input.expectedPlanKey === input.providerPlanKey) &&
    (!input.expectedBillingInterval || input.expectedBillingInterval === input.providerBillingInterval)
  const active = input.providerStatus === "active" || input.providerStatus === "trialing"
  let succeeded = false

  switch (input.mutationKind) {
    case "scheduled_plan_change":
      succeeded = (active || input.verifiedDeferredPause === true) &&
        Boolean(input.toPlanKey) &&
        input.scheduledPlanKey === input.toPlanKey &&
        input.scheduledPlanKey === input.scheduledTargetPlanKey &&
        Boolean(input.scheduledPlanInterval) &&
        input.scheduledPlanInterval === input.scheduledTargetInterval
      break
    case "cancel":
      succeeded = active && planMatches && metadataMatches && input.cancelAtPeriodEnd
      break
    case "resume":
      succeeded = active && planMatches && metadataMatches && !input.cancelAtPeriodEnd
      break
    case "undo_plan_change":
      succeeded = active && planMatches && metadataMatches && !input.scheduledPlanKey && !input.cancelAtPeriodEnd
      break
    default:
      succeeded = active && planMatches && metadataMatches
  }

  if (succeeded) return { state: "succeeded", errorCode: null }
  if (input.transitionKind === "checkout" && ["canceled", "expired", "unpaid"].includes(input.providerStatus)) {
    return { state: "failed", errorCode: "CHECKOUT_NOT_ACTIVATED" }
  }
  if (input.pendingUpdateExpired && input.mutationKind === "plan_change") {
    return { state: "failed", errorCode: "PROVIDER_CHANGE_NOT_APPLIED" }
  }
  if (input.mutationKind === "plan_change" && !metadataMatches && input.hasPendingUpdate === false) {
    return { state: "failed", errorCode: "PROVIDER_CHANGE_NOT_APPLIED" }
  }
  if (input.mutationKind === "cancel" && active && planMatches && metadataMatches && !input.cancelAtPeriodEnd) {
    return { state: "failed", errorCode: "PROVIDER_CHANGE_NOT_APPLIED" }
  }
  return null
}

export function getMutationSettlementSteps(
  currentState: string,
  targetState: "succeeded" | "failed",
): Array<"pending" | "succeeded" | "failed"> {
  if (currentState === "pending") return [targetState]
  if (currentState === "unknown") return targetState === "succeeded" ? ["succeeded"] : ["pending", "failed"]
  return []
}

async function syncSettledBillingMutation(
  db: any,
  workspaceId: string,
  mutationId: string,
  transitionId: string,
  state: "succeeded" | "failed",
  outcome: Record<string, unknown>,
  errorCode: string | null,
  providerReference: string,
  providerPlanKey: string,
  providerStatus: ProviderSubscriptionSnapshot["status"],
) {
  const { data: mutation, error: mutationReadError } = await db.from("billing_mutations")
    .select("result")
    .eq("id", mutationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (mutationReadError) throw new Error(mutationReadError.message)
  const result = {
    ...asRecord(mutation?.result),
    ...outcome,
    providerReference,
    planKey: providerPlanKey,
    providerStatus,
    transitionId,
    status: state,
  }
  const { error: mutationUpdateError } = await db.from("billing_mutations")
    .update({ status: state, result, error_code: state === "failed" ? errorCode || "PROVIDER_MUTATION_FAILED" : null })
    .eq("id", mutationId)
    .eq("workspace_id", workspaceId)
    .in("status", ["pending", "unknown"])
  if (mutationUpdateError) throw new Error(mutationUpdateError.message)
}

export async function settleProviderMutation(
  db: any,
  { workspaceId, provider, environment }: Pick<BillingProviderAdapter, "provider" | "environment"> & { workspaceId: string },
  mutationId: string | undefined,
  providerStatus: ProviderSubscriptionSnapshot["status"],
  providerPlanKey: string,
  providerReference: string,
  providerState: {
    mutationKind?: string
    scheduledPlanKey: string | null
    scheduledPlanInterval?: string | null
    scheduledTargetPlanKey?: string | null
    scheduledTargetInterval?: string | null
    expectedPlanKey?: string | null
    expectedBillingInterval?: string | null
    providerBillingInterval?: string | null
    cancelAtPeriodEnd: boolean
    hasPendingUpdate?: boolean
    pendingUpdateExpired?: boolean
    verifiedDeferredPause?: boolean
  } = {
    scheduledPlanKey: null,
    cancelAtPeriodEnd: false,
  },
) {
  if (!mutationId || !uuidValue(mutationId)) return
  const { data: transition, error } = await db.from("billing_mutation_transitions")
    .select("id, kind, state, to_plan_key, outcome, last_error_code")
    .eq("mutation_id", mutationId)
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .eq("environment", environment)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!transition) return

  const observedOutcome = { providerReference, planKey: providerPlanKey, providerStatus }
  if (transition.state === "succeeded" || transition.state === "failed") {
    await syncSettledBillingMutation(
      db, workspaceId, mutationId, transition.id, transition.state,
      asRecord(transition.outcome), transition.last_error_code || null,
      providerReference, providerPlanKey, providerStatus,
    )
    return
  }

  if (transition.state !== "pending" && transition.state !== "unknown") return
  const settlement = getProviderMutationSettlement({
    transitionKind: transition.kind,
    toPlanKey: transition.to_plan_key,
    mutationKind: providerState.mutationKind,
    providerStatus,
    providerPlanKey,
    providerBillingInterval: providerState.providerBillingInterval,
    expectedPlanKey: providerState.expectedPlanKey,
    expectedBillingInterval: providerState.expectedBillingInterval,
    scheduledPlanKey: providerState.scheduledPlanKey,
    scheduledPlanInterval: providerState.scheduledPlanInterval,
    scheduledTargetPlanKey: providerState.scheduledTargetPlanKey,
    scheduledTargetInterval: providerState.scheduledTargetInterval,
    cancelAtPeriodEnd: providerState.cancelAtPeriodEnd,
    hasPendingUpdate: providerState.hasPendingUpdate,
    pendingUpdateExpired: providerState.pendingUpdateExpired,
    verifiedDeferredPause: providerState.verifiedDeferredPause,
  })
  if (!settlement) return

  let state = transition.state
  let resolution: Awaited<ReturnType<typeof updateBillingMutationTransition>> | null = null
  for (const targetState of getMutationSettlementSteps(transition.state, settlement.state)) {
    resolution = await updateBillingMutationTransition({
      transitionId: transition.id,
      state: targetState,
      outcome: targetState === "pending" ? observedOutcome : { ...observedOutcome, errorCode: settlement.errorCode },
      errorCode: targetState === "failed" ? settlement.errorCode : null,
      expectedState: state,
    }, db)
    state = resolution.state
    if (state !== targetState && state !== settlement.state) break
  }

  if (state === "succeeded" || state === "failed") {
    await syncSettledBillingMutation(
      db, workspaceId, mutationId, transition.id, state,
      resolution ? asRecord(resolution.outcome) : observedOutcome,
      resolution?.last_error_code || (state === "failed" ? settlement.errorCode : null),
      providerReference, providerPlanKey, providerStatus,
    )
  }
}
