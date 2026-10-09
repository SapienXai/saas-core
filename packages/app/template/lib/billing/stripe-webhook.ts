import "server-only"

import { randomUUID } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { getBillingEnvironment } from "./config"
import { getProviderPriceByProviderId, isPaidPlanKey, type ProviderPriceMapping } from "./price-mapping"
import {
  getConfiguredFallbackPlanKey,
  isTerminalBillingSubscription,
  projectCanonicalSubscription,
  type CanonicalSubscription,
} from "./reconciliation"
import { createStripeBillingAdapter } from "./providers/stripe"
import {
  claimBillingWebhookEvent,
  finalizeBillingWebhookEvent,
  recordBillingWebhookEvent,
  upsertBillingProviderAccount,
  updateBillingMutationTransition,
} from "./persistence"
import type { ProviderCheckoutSession, ProviderSubscriptionSnapshot } from "./provider"

export const STRIPE_BILLING_PROVIDER = "stripe"

export function isInitialStripeSubscriptionSourceEligible(source: string | null | undefined) {
  return source === "system" || source === "provider" || source === "trial"
}

export type NormalizedStripeEvent = {
  eventId: string
  eventType: string
  occurredAt: string
  livemode: boolean
  accountId: string | null
  objectId: string
  objectType: string | null
  subscriptionId: string | null
  workspaceId: string | null
  object: Record<string, unknown>
}

export class StripeBillingSyncError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "StripeBillingSyncError"
    this.code = code
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function idValue(value: unknown): string | null {
  return typeof value === "string" ? stringValue(value) : stringValue(asRecord(value).id)
}

function uuidValue(value: unknown) {
  const text = stringValue(value)
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null
}

function invoiceSubscriptionId(object: Record<string, unknown>) {
  const direct = idValue(object.subscription)
  if (direct) return direct
  const parent = asRecord(object.parent)
  const subscriptionDetails = asRecord(parent.subscription_details)
  return idValue(subscriptionDetails.subscription)
}

function getSubscriptionId(object: Record<string, unknown>, objectType: string | null) {
  if (objectType === "subscription") return stringValue(object.id)
  if (objectType === "invoice") return invoiceSubscriptionId(object)
  if (objectType === "subscription_schedule") return idValue(object.subscription)
  return null
}

function getWorkspaceId(object: Record<string, unknown>) {
  const metadata = asRecord(object.metadata)
  if (uuidValue(metadata.workspace_id)) return uuidValue(metadata.workspace_id)
  if (uuidValue(metadata.saas_core_workspace_id)) return uuidValue(metadata.saas_core_workspace_id)
  const parent = asRecord(object.parent)
  const subscriptionDetails = asRecord(parent.subscription_details)
  const subscriptionMetadata = asRecord(subscriptionDetails.metadata)
  return uuidValue(subscriptionMetadata.workspace_id || subscriptionMetadata.saas_core_workspace_id)
}

export function normalizeStripeEvent(value: unknown): NormalizedStripeEvent {
  const event = asRecord(value)
  const eventId = stringValue(event.id)
  const eventType = stringValue(event.type)
  const created = typeof event.created === "number" ? event.created : Number.NaN
  const data = asRecord(event.data)
  const object = asRecord(data.object)
  const objectType = stringValue(object.object)
  const objectId = stringValue(object.id)
  if (!eventId || !eventType || !Number.isFinite(created) || created <= 0 || typeof event.livemode !== "boolean" || !objectId) {
    throw new StripeBillingSyncError("INVALID_EVENT", "Stripe webhook event metadata is incomplete or invalid.")
  }
  const occurredAt = new Date(created * 1000).toISOString()
  const subscriptionId = getSubscriptionId(object, objectType)
  return {
    eventId,
    eventType,
    occurredAt,
    livemode: event.livemode === true,
    accountId: stringValue(event.account),
    objectId,
    objectType,
    subscriptionId,
    workspaceId: getWorkspaceId(object),
    object,
  }
}

function isSupportedStripeEvent(eventType: string) {
  return eventType.startsWith("customer.subscription.") ||
    eventType.startsWith("subscription_schedule.") ||
    eventType.startsWith("checkout.session.") ||
    ["invoice.payment_failed", "invoice.payment_succeeded", "invoice.paid", "invoice.payment_action_required", "invoice.voided", "invoice.marked_uncollectible"].includes(eventType)
}

export function getStripeCheckoutEventStatus(
  session: Pick<ProviderCheckoutSession, "status" | "paymentStatus">,
  eventType?: string,
): "created" | "completed" | "expired" | "failed" {
  if (eventType === "checkout.session.async_payment_failed") return "failed"
  if (session.status === "expired" || eventType === "checkout.session.expired") return "expired"
  if (session.status === "complete" && (session.paymentStatus === "paid" || session.paymentStatus === "no_payment_required")) return "completed"
  return "created"
}

export async function recordStripeWebhookEvent(event: NormalizedStripeEvent) {
  const environment = getBillingEnvironment()
  if (event.livemode !== (environment === "live")) {
    throw new StripeBillingSyncError("ENVIRONMENT_MISMATCH", "Stripe webhook mode does not match this deployment.")
  }
  const db = createServiceRoleClient() as any
  const existing = await db.from("billing_webhook_events")
    .select("id")
    .eq("provider", STRIPE_BILLING_PROVIDER)
    .eq("environment", environment)
    .eq("provider_event_id", event.eventId)
    .maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  const stored = await recordBillingWebhookEvent({
    provider: STRIPE_BILLING_PROVIDER,
    environment,
    providerEventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    providerObjectId: event.subscriptionId || event.objectId,
    workspaceId: event.workspaceId,
    payload: {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      livemode: event.livemode,
      accountId: event.accountId,
      objectId: event.objectId,
      objectType: event.objectType,
      subscriptionId: event.subscriptionId,
      workspaceId: event.workspaceId,
      object: event.object,
    },
  }, db)
  return { id: stored.id, duplicate: Boolean(existing.data), status: stored.status, environment }
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

async function claimWorkspaceProjection(db: any, workspaceId: string) {
  const leaseToken = randomUUID()
  const { data, error } = await db.rpc("claim_billing_projection", {
    p_workspace_id: workspaceId,
    p_lease_token: leaseToken,
    p_lease_seconds: 30,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row.lease_revision !== "number") {
    throw new StripeBillingSyncError("PROJECTION_BUSY", "Workspace billing is being reconciled by another worker.")
  }
  return { leaseToken, revision: row.lease_revision as number }
}

async function releaseWorkspaceProjection(db: any, workspaceId: string, leaseToken: string, revision: number) {
  const { error } = await db.rpc("release_billing_projection", {
    p_workspace_id: workspaceId,
    p_lease_token: leaseToken,
    p_lease_revision: revision,
  })
  if (error) throw new Error(error.message)
}

async function validateInitialCheckoutCorrelation(
  db: any,
  input: { workspaceId: string; environment: "sandbox" | "live"; mutationId: string; planKey: string; priceId: string },
) {
  const { data: mutation, error: mutationError } = await db.from("billing_mutations")
    .select("id, operation, status")
    .eq("id", input.mutationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle()
  if (mutationError) throw new Error(mutationError.message)
  if (!mutation || mutation.operation !== "checkout" || !["pending", "succeeded", "unknown"].includes(mutation.status)) {
    throw new StripeBillingSyncError("CHECKOUT_MUTATION_MISMATCH", "Stripe subscription is not linked to a valid checkout mutation.")
  }
  const { data: checkout, error: checkoutError } = await db.from("billing_checkout_sessions")
    .select("workspace_id, target_plan_key, provider_price_id, status")
    .eq("provider", STRIPE_BILLING_PROVIDER)
    .eq("environment", input.environment)
    .eq("workspace_id", input.workspaceId)
    .eq("idempotency_key", input.mutationId)
    .maybeSingle()
  if (checkoutError) throw new Error(checkoutError.message)
  if (!checkout || checkout.target_plan_key !== input.planKey || checkout.provider_price_id !== input.priceId || checkout.status === "failed" || checkout.status === "expired") {
    throw new StripeBillingSyncError("CHECKOUT_CORRELATION_MISMATCH", "Stripe subscription does not match the recorded checkout request.")
  }
}

async function applyStripeSubscriptionProjection(event: NormalizedStripeEvent, subscriptionId: string) {
  const environment = getBillingEnvironment()
  const db = createServiceRoleClient() as any
  const adapter = createStripeBillingAdapter()
  const { data: linked, error: linkedError } = await db.from("workspace_subscriptions")
    .select("workspace_id")
    .eq("provider", STRIPE_BILLING_PROVIDER)
    .eq("provider_environment", environment)
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle()
  if (linkedError) throw new Error(linkedError.message)
  const metadataWorkspaceId = uuidValue(event.workspaceId)
  const workspaceId = stringValue(linked?.workspace_id) || metadataWorkspaceId
  if (!workspaceId) throw new StripeBillingSyncError("UNKNOWN_WORKSPACE", "Stripe subscription is not linked to a workspace.")
  if (linked?.workspace_id && metadataWorkspaceId && linked.workspace_id !== metadataWorkspaceId) {
    throw new StripeBillingSyncError("WORKSPACE_MISMATCH", "Stripe subscription metadata conflicts with its existing workspace link.")
  }

  const lease = await claimWorkspaceProjection(db, workspaceId)
  let committed = false
  try {
    const { data: current, error: currentError } = await db.from("workspace_subscriptions")
      .select("workspace_id, plan_key, status, source, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_status, billing_interval, billing_currency, current_period_start, current_period_end, current_period_start_at, current_period_end_at, cancel_at_period_end, scheduled_change_at, scheduled_change_action, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, scheduled_plan_interval, scheduled_provider_price_id, last_provider_event_at, last_provider_event_id, payment_failure_started_at, payment_grace_ends_at, billing_issue_code")
      .eq("workspace_id", workspaceId)
      .single()
    if (currentError || !current) throw new Error(currentError?.message || "Workspace subscription does not exist.")

    const subscription = await adapter.retrieveSubscription(subscriptionId)
    const subscriptionWorkspaceId = subscription.customData.workspace_id || subscription.customData.saas_core_workspace_id
    if (subscriptionWorkspaceId && uuidValue(subscriptionWorkspaceId) !== workspaceId) {
      throw new StripeBillingSyncError("WORKSPACE_MISMATCH", "Stripe subscription metadata conflicts with its workspace link.")
    }
    if (subscription.customData.billing_environment && subscription.customData.billing_environment !== environment) {
      throw new StripeBillingSyncError("ENVIRONMENT_MISMATCH", "Stripe subscription metadata belongs to another billing environment.")
    }
    if (subscription.customData.billing_provider && subscription.customData.billing_provider !== STRIPE_BILLING_PROVIDER) {
      throw new StripeBillingSyncError("PROVIDER_MISMATCH", "Stripe subscription metadata names another billing provider.")
    }
    if (subscription.livemode !== (environment === "live")) {
      throw new StripeBillingSyncError("ENVIRONMENT_MISMATCH", "Stripe subscription belongs to another billing environment.")
    }
    if (subscription.issueCode === "unsupported_subscription_schedule" || subscription.issueCode === "unmanaged_subscription_schedule") {
      throw new StripeBillingSyncError("UNSUPPORTED_SCHEDULE", "Stripe subscription has a schedule this product cannot safely manage.")
    }

    const priceId = subscription.items[0]?.priceId
    if (!priceId) throw new StripeBillingSyncError("UNKNOWN_PRICE", "Stripe subscription does not contain a registered Price.")
    const mapping = await getProviderPriceByProviderId(STRIPE_BILLING_PROVIDER, priceId, environment, false)
    if (!mapping || !isPaidPlanKey(mapping.plan_key)) throw new StripeBillingSyncError("UNKNOWN_PRICE", "Stripe subscription Price is not registered for this environment.")
    const productId = subscription.items[0]?.productId
    if (productId && productId !== mapping.provider_product_id) {
      throw new StripeBillingSyncError("UNKNOWN_PRODUCT", "Stripe subscription Product does not match its registered Price.")
    }

    const replacingSubscription = Boolean(current.provider_subscription_id && current.provider_subscription_id !== subscriptionId)
    const oldStatus = current.provider_status || current.status
    if (current.provider_subscription_id === subscriptionId && current.provider && current.provider !== STRIPE_BILLING_PROVIDER) {
      throw new StripeBillingSyncError("PROVIDER_MISMATCH", "Stripe subscription ID conflicts with the Workspace's existing provider link.")
    }
    if (current.provider_subscription_id && current.provider_environment && current.provider_environment !== environment) {
      throw new StripeBillingSyncError("ENVIRONMENT_MISMATCH", "Workspace subscription belongs to another billing environment.")
    }
    if (replacingSubscription && !isTerminalBillingSubscription(oldStatus)) {
      throw new StripeBillingSyncError("DUPLICATE_PROVIDER_SUBSCRIPTION", "Workspace already has another non-terminal subscription.")
    }
    if (replacingSubscription && current.provider && current.provider !== STRIPE_BILLING_PROVIDER && !isTerminalBillingSubscription(oldStatus)) {
      throw new StripeBillingSyncError("PROVIDER_MISMATCH", "Workspace is linked to another billing provider.")
    }
    if (!replacingSubscription && current.provider && current.provider !== STRIPE_BILLING_PROVIDER && current.provider_subscription_id) {
      throw new StripeBillingSyncError("PROVIDER_MISMATCH", "Workspace is linked to another billing provider.")
    }
    // A server-granted no-card trial may convert to its first provider subscription.
    // Manual commercial overrides remain ineligible for an initial Stripe checkout.
    if (!replacingSubscription && !current.provider_subscription_id && !isInitialStripeSubscriptionSourceEligible(current.source)) {
      throw new StripeBillingSyncError("WORKSPACE_NOT_BILLING_ELIGIBLE", "Workspace already has a non-provider commercial state.")
    }
    if (replacingSubscription || !current.provider_subscription_id) {
      const mutationId = stringValue(subscription.customData.billing_mutation_id)
      if (!mutationId) throw new StripeBillingSyncError("CHECKOUT_MUTATION_MISSING", "Initial Stripe subscription has no billing mutation reference.")
      await validateInitialCheckoutCorrelation(db, {
        workspaceId,
        environment,
        mutationId,
        planKey: mapping.plan_key,
        priceId,
      })
    }

    let scheduledPlan: { mapping: ProviderPriceMapping; effectiveAt: string } | null = null
    if (subscription.scheduledPlan) {
      const targetMapping = await getProviderPriceByProviderId(STRIPE_BILLING_PROVIDER, subscription.scheduledPlan.priceId, environment, false)
      if (!targetMapping || !isPaidPlanKey(targetMapping.plan_key)) {
        throw new StripeBillingSyncError("UNKNOWN_SCHEDULED_PRICE", "Stripe scheduled Price is not registered for this environment.")
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
    const patch = {
      plan_key: projection.planKey,
      status: projection.status,
      source: "provider",
      provider: STRIPE_BILLING_PROVIDER,
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
      scheduled_change_at: subscription.cancelEffectiveAt,
      scheduled_change_action: subscription.cancelAtPeriodEnd ? "cancel" : null,
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
    const { data: updated, error: updateError } = await db.from("workspace_subscriptions")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("billing_projection_revision", lease.revision)
      .eq("billing_projection_lease_token", lease.leaseToken)
      .select("workspace_id")
      .maybeSingle()
    if (updateError) throw new Error(updateError.message)
    if (!updated) throw new StripeBillingSyncError("STALE_PROJECTION_LEASE", "Workspace billing projection lease was replaced before finalization.")
    committed = true

    if (subscription.customerId) {
      await upsertBillingProviderAccount({
        workspaceId,
        provider: STRIPE_BILLING_PROVIDER,
        environment,
        providerAccountId: subscription.customerId,
        providerCustomerId: subscription.customerId,
        metadata: { subscriptionId: subscription.id },
      }, db)
    }
    await settleProviderMutation(
      db,
      workspaceId,
      subscription.customData.billing_schedule_mutation_id || subscription.customData.billing_mutation_id,
      subscription.status,
      mapping.plan_key,
      subscription.id,
      {
        mutationKind: subscription.customData.billing_schedule_mutation_id
          ? subscription.customData.billing_schedule_mutation_kind
          : subscription.customData.billing_mutation_kind,
        scheduledPlanKey: scheduledPlan?.mapping.plan_key || null,
        scheduledPlanInterval: scheduledPlan?.mapping.billing_interval || null,
        scheduledTargetPlanKey: stringValue(subscription.customData.billing_schedule_target_plan_key),
        scheduledTargetInterval: stringValue(subscription.customData.billing_schedule_target_interval),
        expectedPlanKey: stringValue(subscription.customData.plan_key),
        expectedBillingInterval: stringValue(subscription.customData.billing_interval),
        providerBillingInterval: mapping.billing_interval,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        hasPendingUpdate: subscription.hasPendingUpdate,
        pendingUpdateExpired: event.eventType === "customer.subscription.pending_update_expired",
      },
    )
    return { status: "processed" as const, workspaceId, planKey: projection.planKey, subscriptionStatus: projection.status }
  } finally {
    if (!committed) {
      try { await releaseWorkspaceProjection(db, workspaceId, lease.leaseToken, lease.revision) }
      catch (error) { console.error("Could not release Stripe projection lease", { workspaceId, message: error instanceof Error ? error.message : String(error) }) }
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
}): ProviderMutationSettlement {
  const planMatches = !input.toPlanKey || input.toPlanKey === input.providerPlanKey
  const metadataMatches = (!input.expectedPlanKey || input.expectedPlanKey === input.providerPlanKey) &&
    (!input.expectedBillingInterval || input.expectedBillingInterval === input.providerBillingInterval)
  const active = input.providerStatus === "active" || input.providerStatus === "trialing"
  let succeeded = false

  switch (input.mutationKind) {
    case "scheduled_plan_change":
      succeeded = active &&
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

async function settleProviderMutation(
  db: any,
  workspaceId: string,
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
  } = {
    scheduledPlanKey: null,
    cancelAtPeriodEnd: false,
  },
) {
  if (!mutationId) return
  const { data: transition, error } = await db.from("billing_mutation_transitions")
    .select("id, kind, state, to_plan_key, outcome, last_error_code")
    .eq("mutation_id", mutationId)
    .eq("workspace_id", workspaceId)
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

async function applyStripeCheckoutEvent(event: NormalizedStripeEvent) {
  const environment = getBillingEnvironment()
  const sessionId = event.objectId
  const adapter = createStripeBillingAdapter()
  const session: ProviderCheckoutSession = await adapter.retrieveCheckoutSession(sessionId)
  const db = createServiceRoleClient() as any
  const { data: checkout, error } = await db.from("billing_checkout_sessions")
    .select("workspace_id, target_plan_key, provider_price_id, status, idempotency_key")
    .eq("provider", STRIPE_BILLING_PROVIDER)
    .eq("environment", environment)
    .eq("provider_transaction_id", sessionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!checkout) throw new StripeBillingSyncError("UNKNOWN_CHECKOUT", "Stripe Checkout Session is not linked to a recorded Workspace request.")
  const mapping = session.metadata.billing_interval
    ? await getProviderPriceByProviderId(STRIPE_BILLING_PROVIDER, checkout.provider_price_id, environment, false)
    : null
  if (session.workspaceId !== checkout.workspace_id || event.workspaceId !== checkout.workspace_id) {
    throw new StripeBillingSyncError("WORKSPACE_MISMATCH", "Stripe Checkout Session does not match its recorded Workspace.")
  }
  if (session.mutationId !== checkout.idempotency_key) {
    throw new StripeBillingSyncError("MUTATION_MISMATCH", "Stripe Checkout Session does not match its billing mutation.")
  }
  if (session.livemode !== (environment === "live")) throw new StripeBillingSyncError("ENVIRONMENT_MISMATCH", "Stripe Checkout Session belongs to another environment.")
  if (session.metadata.billing_provider !== STRIPE_BILLING_PROVIDER ||
    session.metadata.billing_environment !== environment ||
    session.metadata.plan_key !== checkout.target_plan_key ||
    !mapping || mapping.plan_key !== checkout.target_plan_key ||
    mapping.billing_interval !== session.metadata.billing_interval) {
    throw new StripeBillingSyncError("CHECKOUT_MAPPING_MISMATCH", "Stripe Checkout metadata does not match its registered Price mapping.")
  }

  const status = getStripeCheckoutEventStatus(session, event.eventType)

  const { error: updateError } = await db.from("billing_checkout_sessions")
    .update({ status })
    .eq("provider", STRIPE_BILLING_PROVIDER)
    .eq("environment", environment)
    .eq("workspace_id", checkout.workspace_id)
    .eq("provider_transaction_id", sessionId)
  if (updateError) throw new Error(updateError.message)

  if (status === "expired" || status === "failed") {
    await settleProviderMutation(db, checkout.workspace_id, checkout.idempotency_key, "expired", checkout.target_plan_key, session.id)
  }

  // A completed Checkout return never grants access. Re-read the subscription
  // from Stripe and let its payment-confirmed lifecycle state drive entitlements.
  if (status !== "completed" || !session.subscriptionId) return { status: "processed" as const, workspaceId: checkout.workspace_id }
  return applyStripeSubscriptionProjection(event, session.subscriptionId)
}

export async function applyStripeEvent(event: NormalizedStripeEvent) {
  if (!isSupportedStripeEvent(event.eventType)) return { status: "ignored" as const, reason: "UNSUPPORTED_EVENT" as const }
  if (event.eventType.startsWith("checkout.session.")) return applyStripeCheckoutEvent(event)
  if (!event.subscriptionId) return { status: "ignored" as const, reason: "NO_SUBSCRIPTION_REFERENCE" as const }
  return applyStripeSubscriptionProjection(event, event.subscriptionId)
}

function retryAt(attempts: number, now: Date) {
  const seconds = Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1))
  return new Date(now.getTime() + seconds * 1000).toISOString()
}

export async function processStoredStripeWebhookEvent(eventId: string) {
  const db = createServiceRoleClient() as any
  const { data: loaded, error: loadError } = await db.from("billing_webhook_events")
    .select("id, status, attempts, next_attempt_at")
    .eq("id", eventId)
    .eq("provider", STRIPE_BILLING_PROVIDER)
    .single()
  if (loadError || !loaded) throw new Error(loadError?.message || "Stripe webhook event was not found.")
  if (loaded.status === "processed" || loaded.status === "ignored") return loaded.status
  const now = new Date()
  const leaseToken = randomUUID()
  const claim = await claimBillingWebhookEvent({ eventId, leaseToken, leaseSeconds: 300, allowReclaim: true, now }, db)
  if (!claim.claimed) return claim.status as "received" | "processing" | "failed" | "processed" | "ignored"
  try {
    const payload = asRecord(claim.payload)
    const event = normalizeStripeEvent({
      id: payload.eventId,
      type: payload.eventType,
      created: Math.floor(new Date(String(payload.occurredAt)).getTime() / 1000),
      livemode: payload.livemode,
      account: payload.accountId,
      data: { object: payload.object },
    })
    const result = await applyStripeEvent(event)
    await finalizeBillingWebhookEvent({ eventId, leaseToken, status: result.status, errorCode: result.status === "ignored" ? result.reason : null, now }, db)
    return result.status
  } catch (error) {
    const code = error instanceof StripeBillingSyncError ? error.code : "PROCESSING_FAILED"
    const message = error instanceof Error ? error.message : "Stripe webhook processing failed."
    const nextAttemptAt = claim.attempts < claim.max_attempts ? retryAt(claim.attempts, now) : null
    try {
      await finalizeBillingWebhookEvent({ eventId, leaseToken, status: "failed", errorCode: code, errorMessage: message.slice(0, 2000), nextAttemptAt, now }, db)
    } catch (finalizeError) {
      console.error("Could not finalize Stripe webhook failure", { eventId, message: finalizeError instanceof Error ? finalizeError.message : String(finalizeError) })
    }
    console.error("Stripe webhook processing failed", { eventId, code, message })
    return "failed" as const
  }
}

export async function reconcileStripeSubscription(subscriptionId: string, workspaceId: string) {
  const environment = getBillingEnvironment()
  const db = createServiceRoleClient() as any
  const { data: linked, error } = await db.from("workspace_subscriptions")
    .select("workspace_id, provider, provider_environment, provider_subscription_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!linked || linked.provider !== STRIPE_BILLING_PROVIDER || linked.provider_environment !== environment || linked.provider_subscription_id !== subscriptionId) {
    throw new StripeBillingSyncError("SUBSCRIPTION_LINK_MISMATCH", "Stripe subscription does not match the active Workspace billing record.")
  }
  const occurredAt = new Date().toISOString()
  const syntheticEvent = normalizeStripeEvent({
    id: `reconcile_${subscriptionId}_${Date.now()}`,
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    livemode: environment === "live",
    data: { object: { id: subscriptionId, object: "subscription", metadata: { workspace_id: workspaceId } } },
  })
  return applyStripeSubscriptionProjection({ ...syntheticEvent, occurredAt, workspaceId }, subscriptionId)
}

export async function reconcileStripeCheckoutSession(checkoutSessionId: string, workspaceId: string) {
  const environment = getBillingEnvironment()
  const db = createServiceRoleClient() as any
  const { data: checkout, error } = await db.from("billing_checkout_sessions")
    .select("workspace_id, environment, target_plan_key, provider_price_id, provider_transaction_id, idempotency_key")
    .eq("provider", STRIPE_BILLING_PROVIDER)
    .eq("environment", environment)
    .eq("workspace_id", workspaceId)
    .eq("provider_transaction_id", checkoutSessionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!checkout) throw new StripeBillingSyncError("UNKNOWN_CHECKOUT", "Checkout Session is not linked to a recorded Workspace request.")
  const adapter = createStripeBillingAdapter()
  const session = await adapter.retrieveCheckoutSession(checkoutSessionId)
  if (session.workspaceId !== workspaceId || session.mutationId !== checkout.idempotency_key ||
    session.metadata.plan_key !== checkout.target_plan_key || session.metadata.billing_environment !== environment ||
    session.metadata.billing_provider !== STRIPE_BILLING_PROVIDER || session.livemode !== (environment === "live")) {
    throw new StripeBillingSyncError("CHECKOUT_CORRELATION_MISMATCH", "Checkout Session does not match its recorded Workspace request.")
  }
  if (checkout.environment !== environment) throw new StripeBillingSyncError("ENVIRONMENT_MISMATCH", "Checkout Session belongs to another environment.")
  if (session.status !== "complete" || (session.paymentStatus !== "paid" && session.paymentStatus !== "no_payment_required")) {
    if (session.status === "expired") {
      const occurredAt = new Date().toISOString()
      const failed = normalizeStripeEvent({
        id: "checkout_return_" + session.id + "_" + Date.now(),
        type: "checkout.session.expired",
        created: Math.floor(Date.now() / 1000),
        livemode: session.livemode,
        data: { object: { id: session.id, object: "checkout.session", metadata: session.metadata } },
      })
      await applyStripeCheckoutEvent({ ...failed, occurredAt, workspaceId })
      return { status: "failed" as const, workspaceId }
    }
    return { status: "pending" as const, workspaceId }
  }
  if (!session.subscriptionId) return { status: "pending" as const, workspaceId }
  const completed = normalizeStripeEvent({
    id: "checkout_return_" + session.id + "_" + Date.now(),
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: session.livemode,
    data: { object: { id: session.id, object: "checkout.session", metadata: session.metadata } },
  })
  const result = await applyStripeCheckoutEvent({ ...completed, occurredAt: new Date().toISOString(), workspaceId })
  const { data: transition, error: transitionError } = await db.from("billing_mutation_transitions")
    .select("id")
    .eq("mutation_id", checkout.idempotency_key)
    .eq("workspace_id", workspaceId)
    .eq("kind", "checkout")
    .maybeSingle()
  if (transitionError) throw new Error(transitionError.message)
  return { ...result, transitionId: transition?.id || null }
}

export function isStripeBillingWebhookEvent(value: unknown): value is NormalizedStripeEvent {
  const event = asRecord(value)
  return Boolean(stringValue(event.eventId) && stringValue(event.eventType) && stringValue(event.objectId) && typeof event.livemode === "boolean")
}
