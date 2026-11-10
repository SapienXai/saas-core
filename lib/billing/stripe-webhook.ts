import "server-only"

import { randomUUID } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { getBillingEnvironment } from "./config"
import { getProviderPriceByProviderId } from "./price-mapping"
import { createStripeBillingAdapter } from "./providers/stripe"
import { claimBillingWebhookEvent, finalizeBillingWebhookEvent, recordBillingWebhookEvent } from "./persistence"
import {
  applyProviderSubscriptionProjection, BillingProjectionError as StripeBillingSyncError, settleProviderMutation,
} from "./subscription-projection"
import type { ProviderCheckoutSession } from "./provider"

export { StripeBillingSyncError }
export {
  getMutationSettlementSteps,
  getProviderMutationSettlement,
  isInitialSubscriptionSourceEligible as isInitialStripeSubscriptionSourceEligible,
} from "./subscription-projection"

export const STRIPE_BILLING_PROVIDER = "stripe"

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

export function isSettledStripeCheckoutProjection(input: {
  workspaceId: string
  environment: "sandbox" | "live"
  planKey: string
  priceId: string
  subscriptionId: string
  subscription: {
    workspace_id: string
    plan_key: string
    status: string
    source: string
    provider: string | null
    provider_environment: string | null
    provider_subscription_id: string | null
    provider_price_id: string | null
    provider_status: string | null
  } | null
  transition: { id: string; state: string } | null
}) {
  const { subscription, transition } = input
  return Boolean(subscription && transition &&
    subscription.workspace_id === input.workspaceId &&
    subscription.plan_key === input.planKey &&
    subscription.source === "provider" &&
    subscription.provider === STRIPE_BILLING_PROVIDER &&
    subscription.provider_environment === input.environment &&
    subscription.provider_subscription_id === input.subscriptionId &&
    subscription.provider_price_id === input.priceId &&
    ["active", "trialing"].includes(subscription.status) &&
    ["active", "trialing"].includes(subscription.provider_status || "") &&
    transition.state === "succeeded")
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

function applyStripeSubscriptionProjection(event: NormalizedStripeEvent, subscriptionId: string) {
  return applyProviderSubscriptionProjection(event, subscriptionId, createStripeBillingAdapter())
}

async function applyStripeCheckoutEvent(event: NormalizedStripeEvent, verifiedSession?: ProviderCheckoutSession) {
  const environment = getBillingEnvironment()
  const sessionId = event.objectId
  const adapter = createStripeBillingAdapter()
  const session: ProviderCheckoutSession = verifiedSession || await adapter.retrieveCheckoutSession(sessionId)
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

  const [{ data: projected, error: projectionError }, { data: settledTransition, error: settledTransitionError }] = await Promise.all([
    db.from("workspace_subscriptions")
      .select("workspace_id, plan_key, status, source, provider, provider_environment, provider_subscription_id, provider_price_id, provider_status")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db.from("billing_mutation_transitions")
      .select("id, state")
      .eq("mutation_id", checkout.idempotency_key)
      .eq("workspace_id", workspaceId)
      .eq("kind", "checkout")
      .maybeSingle(),
  ])
  if (projectionError || settledTransitionError) throw new Error(projectionError?.message || settledTransitionError?.message)
  if (projected && settledTransition && isSettledStripeCheckoutProjection({
    workspaceId,
    environment,
    planKey: checkout.target_plan_key,
    priceId: checkout.provider_price_id,
    subscriptionId: session.subscriptionId,
    subscription: projected,
    transition: settledTransition,
  })) {
    return {
      status: "processed" as const,
      workspaceId,
      planKey: projected.plan_key,
      subscriptionStatus: projected.provider_status,
      transitionId: settledTransition.id,
    }
  }

  const completed = normalizeStripeEvent({
    id: "checkout_return_" + session.id + "_" + Date.now(),
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: session.livemode,
    data: { object: { id: session.id, object: "checkout.session", metadata: session.metadata } },
  })
  const result = await applyStripeCheckoutEvent({ ...completed, occurredAt: new Date().toISOString(), workspaceId }, session)
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
