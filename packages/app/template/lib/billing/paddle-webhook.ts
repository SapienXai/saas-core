import "server-only"

import { randomUUID } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { isBillingDeferred } from "./config"
import { claimBillingWebhookEvent, finalizeBillingWebhookEvent, recordBillingWebhookEvent } from "./persistence"
import { getProviderPriceByProviderId } from "./price-mapping"
import { createPaddleAdapter, getPaddleConfig, isPaddleTransactionId, retrievePaddleTransaction } from "./providers/paddle"
import { applyProviderSubscriptionProjection, BillingProjectionError, settleProviderMutation } from "./subscription-projection"

const provider = "paddle"
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const checkoutFields = "workspace_id, target_plan_key, provider_price_id, idempotency_key, status"
type EventMarker = { eventId: string; eventType: string; occurredAt: string }
type PaddleEvent = EventMarker & { objectId: string; subscriptionId: string | null; origin: string | null }

export function normalizePaddleEvent(value: unknown): PaddleEvent {
  const event = value as { event_id?: unknown; event_type?: unknown; occurred_at?: unknown; data?: { id?: unknown; subscription_id?: unknown; origin?: unknown } } | null
  if (!event || typeof event.event_id !== "string" || !/^evt_[a-z0-9]{26}$/.test(event.event_id) ||
      typeof event.event_type !== "string" || typeof event.occurred_at !== "string" ||
      !Number.isFinite(Date.parse(event.occurred_at)) || typeof event.data?.id !== "string") {
    throw new Error("Invalid Paddle event.")
  }
  return {
    eventId: event.event_id, eventType: event.event_type, occurredAt: event.occurred_at, objectId: event.data.id,
    subscriptionId: typeof event.data.subscription_id === "string" ? event.data.subscription_id : null,
    origin: typeof event.data.origin === "string" ? event.data.origin : null,
  }
}

export function isPaddleCheckoutEvent(eventType: string) {
  return ["transaction.created", "transaction.completed", "transaction.canceled"].includes(eventType)
}

export function isPaddleSubscriptionEvent(eventType: string) {
  return ["subscription.updated", "subscription.activated", "subscription.trialing", "subscription.canceled", "subscription.paused", "subscription.past_due", "subscription.resumed"].includes(eventType)
}

/** Recover a transaction recorded by Paddle after the Core create request lost its response. */
async function recoverPaddleCheckout(
  db: ReturnType<typeof createServiceRoleClient>,
  environment: "sandbox" | "live",
  transaction: Awaited<ReturnType<typeof retrievePaddleTransaction>>,
) {
  const { session, origin, items } = transaction
  const { workspaceId, mutationId, metadata } = session
  const item = items.length === 1 ? items[0] : null
  if (origin !== "api" || !workspaceId || !uuidPattern.test(workspaceId) || !mutationId || !uuidPattern.test(mutationId) ||
      metadata.billing_checkout_mutation_id !== mutationId || metadata.billing_provider !== provider ||
      metadata.billing_environment !== environment || !item?.price || item.quantity !== 1) return null

  const { data: transition, error } = await db.from("billing_mutation_transitions")
    .select("to_plan_key")
    .eq("workspace_id", workspaceId).eq("mutation_id", mutationId)
    .eq("provider", provider).eq("environment", environment).eq("kind", "checkout")
    .in("state", ["pending", "unknown"]).maybeSingle()
  if (error) throw new Error(error.message)
  if (!transition?.to_plan_key) return null
  const { data: mutation, error: mutationError } = await db.from("billing_mutations")
    .select("operation,status,result").eq("id", mutationId).eq("workspace_id", workspaceId).maybeSingle()
  if (mutationError) throw new Error(mutationError.message)
  const result = mutation?.result
  const intent = result && typeof result === "object" && !Array.isArray(result) ? result : null
  if (!transition?.to_plan_key || mutation?.operation !== "checkout" || !["pending", "unknown"].includes(mutation.status) ||
      intent?.checkoutPriceId !== item.price.id || intent?.interval !== metadata.billing_interval ||
      transition.to_plan_key !== metadata.plan_key) return null

  const mapping = await getProviderPriceByProviderId(provider, item.price.id, environment, false)
  if (!mapping || mapping.plan_key !== transition.to_plan_key || mapping.provider_product_id !== item.price.product_id ||
      mapping.billing_interval !== metadata.billing_interval) return null

  const { error: insertError } = await db.from("billing_checkout_sessions").insert({
    workspace_id: workspaceId, provider, environment, target_plan_key: transition.to_plan_key,
    provider_price_id: item.price.id, provider_transaction_id: session.id, idempotency_key: mutationId, status: "created",
  })
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message)
  const { data, error: readError } = await db.from("billing_checkout_sessions").select(checkoutFields)
    .eq("workspace_id", workspaceId).eq("provider", provider).eq("environment", environment)
    .eq("idempotency_key", mutationId).eq("provider_transaction_id", session.id).maybeSingle()
  if (readError) throw new Error(readError.message)
  return data
}

export async function getVerifiedPaddleCheckout(transactionId: string, workspaceId?: string, recover = false) {
  const { environment } = getPaddleConfig()
  if (!isPaddleTransactionId(transactionId)) return null
  const db = createServiceRoleClient()
  let query = db.from("billing_checkout_sessions").select(checkoutFields)
    .eq("provider", provider).eq("environment", environment).eq("provider_transaction_id", transactionId)
  if (workspaceId) query = query.eq("workspace_id", workspaceId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.status === "failed" || (!data && !recover)) return null

  const transaction = await retrievePaddleTransaction(transactionId)
  const checkout = data ?? await recoverPaddleCheckout(db, environment, transaction)
  if (!checkout) return null
  const { session, items } = transaction
  const item = items.length === 1 ? items[0] : null
  const mapping = await getProviderPriceByProviderId(provider, checkout.provider_price_id, environment, false)
  if (transaction.origin !== "api" || !mapping || !item || mapping.plan_key !== checkout.target_plan_key ||
      item.price?.id !== checkout.provider_price_id || item.price.product_id !== mapping.provider_product_id ||
      item.quantity !== 1 || session.workspaceId !== checkout.workspace_id || session.mutationId !== checkout.idempotency_key ||
      session.metadata.billing_provider !== provider || session.metadata.billing_environment !== environment ||
      session.metadata.plan_key !== checkout.target_plan_key || session.metadata.billing_interval !== mapping.billing_interval) {
    throw new Error("Paddle transaction does not match the recorded Workspace checkout.")
  }
  return { checkout, session }
}

export async function getVerifiedPaddlePaymentUpdate(transactionId: string, workspaceId: string) {
  const { environment } = getPaddleConfig()
  if (environment !== "live" || isBillingDeferred() || !isPaddleTransactionId(transactionId)) return false
  const { data: subscription, error } = await createServiceRoleClient().from("workspace_subscriptions")
    .select("provider_subscription_id,provider_customer_id")
    .eq("workspace_id", workspaceId).eq("provider", provider).eq("provider_environment", environment).maybeSingle()
  if (error) throw new Error(error.message)
  if (!subscription?.provider_subscription_id || !subscription.provider_customer_id) return false
  const { session, origin, status } = await retrievePaddleTransaction(transactionId)
  return session.subscriptionId === subscription.provider_subscription_id && session.customerId === subscription.provider_customer_id &&
    ((origin === "subscription_payment_method_change" && status === "ready") ||
      (origin === "subscription_recurring" && status === "past_due"))
}

export async function reconcilePaddleCheckoutSession(transactionId: string, expectedWorkspaceId?: string, event?: EventMarker) {
  const { environment } = getPaddleConfig()
  const verified = await getVerifiedPaddleCheckout(transactionId, expectedWorkspaceId, Boolean(event && !expectedWorkspaceId))
  if (!verified) return { status: "failed" as const, workspaceId: expectedWorkspaceId || null }
  const { checkout, session } = verified
  const workspaceId = checkout.workspace_id as string
  const db = createServiceRoleClient()
  const persistCheckoutStatus = async (status: "expired" | "completed") => {
    const { error } = await db.from("billing_checkout_sessions").update({ status })
      .eq("provider", provider).eq("environment", environment).eq("workspace_id", workspaceId)
      .eq("provider_transaction_id", transactionId).in("status", ["created", status])
    if (error) throw new Error(error.message)
  }
  if (session.status === "expired" && session.paymentStatus === "unpaid" && !session.subscriptionId) {
    await persistCheckoutStatus("expired")
    await settleProviderMutation(db, { workspaceId, provider, environment }, checkout.idempotency_key, "expired", checkout.target_plan_key, transactionId)
    return { status: "failed" as const, workspaceId }
  }
  if (session.status !== "complete" || session.paymentStatus !== "paid" || !session.subscriptionId || !session.customerId) {
    return { status: "pending" as const, workspaceId }
  }
  if (checkout.status === "expired") throw new Error("Completed Paddle transaction conflicts with an expired checkout.")

  if (checkout.status === "completed") {
    const { data: transition, error } = await db.from("billing_mutation_transitions").select("id, state")
      .eq("workspace_id", workspaceId).eq("provider", provider).eq("environment", environment)
      .eq("mutation_id", checkout.idempotency_key).eq("kind", "checkout").maybeSingle()
    if (error) throw new Error(error.message)
    if (transition?.state === "succeeded") {
      const { data: projected, error: projectionError } = await db.from("workspace_subscriptions")
        .select("plan_key,status,provider_price_id")
        .eq("workspace_id", workspaceId).eq("provider", provider).eq("provider_environment", environment)
        .eq("provider_customer_id", session.customerId).eq("provider_subscription_id", session.subscriptionId).maybeSingle()
      if (projectionError) throw new Error(projectionError.message)
      if (!projected || projected.provider_price_id !== checkout.provider_price_id ||
          projected.plan_key !== checkout.target_plan_key ||
          (projected.status !== "active" && projected.status !== "trialing")) {
        return { status: "failed" as const, workspaceId }
      }
      return {
        status: "processed" as const, workspaceId, transitionId: transition.id as string,
        planKey: projected.plan_key as string, subscriptionStatus: projected.status as "active" | "trialing",
      }
    }
  }
  const adapter = createPaddleAdapter()
  const result = await applyProviderSubscriptionProjection(
    { ...(event ?? { eventId: `reconcile_${transactionId}`, occurredAt: new Date().toISOString(), eventType: "transaction.completed" }), workspaceId },
    session.subscriptionId,
    {
      ...adapter,
      async retrieveSubscription(id) {
        const subscription = await adapter.retrieveSubscription(id)
        if (subscription.customerId !== session.customerId ||
            subscription.customData.workspace_id !== workspaceId ||
            (subscription.customData.billing_checkout_mutation_id || subscription.customData.billing_mutation_id) !== checkout.idempotency_key ||
            subscription.items.length !== 1 || subscription.items[0]?.priceId !== checkout.provider_price_id) {
          throw new Error("Paddle subscription does not match the completed transaction.")
        }
        return subscription
      },
    },
    session,
  )
  await persistCheckoutStatus("completed")
  const { data: transition, error } = await db.from("billing_mutation_transitions").select("id")
    .eq("workspace_id", workspaceId).eq("provider", provider).eq("environment", environment)
      .eq("mutation_id", checkout.idempotency_key).eq("kind", "checkout").maybeSingle()
  if (error) throw new Error(error.message)
  return { ...result, transitionId: transition?.id as string | undefined }
}

export async function reconcilePaddleSubscription(subscriptionId: string, expectedWorkspaceId?: string, event?: EventMarker) {
  const { environment } = getPaddleConfig()
  const adapter = createPaddleAdapter()
  const db = createServiceRoleClient()
  let query = db.from("workspace_subscriptions").select("workspace_id")
    .eq("provider", provider).eq("provider_environment", environment).eq("provider_subscription_id", subscriptionId)
  if (expectedWorkspaceId) query = query.eq("workspace_id", expectedWorkspaceId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { status: "ignored" as const, workspaceId: expectedWorkspaceId || null }
  return applyProviderSubscriptionProjection(
    { ...(event ?? { eventId: `reconcile_${subscriptionId}`, occurredAt: new Date().toISOString(), eventType: "subscription.updated" }), workspaceId: data.workspace_id },
    subscriptionId, adapter,
  )
}

export async function recordPaddleEvent(event: PaddleEvent) {
  const { environment } = getPaddleConfig()
  return recordBillingWebhookEvent({
    provider, environment, providerEventId: event.eventId, eventType: event.eventType, occurredAt: event.occurredAt,
    providerObjectId: event.objectId, payload: event,
  })
}

export async function processStoredPaddleWebhookEvent(eventId: string) {
  const { environment } = getPaddleConfig()
  const db = createServiceRoleClient()
  const { data: stored, error } = await db.from("billing_webhook_events").select("id,status")
    .eq("id", eventId).eq("provider", provider).eq("environment", environment).single()
  if (error || !stored) throw new Error("Paddle webhook receipt could not be loaded.")
  if (stored.status === "processed" || stored.status === "ignored") return stored.status
  const now = new Date()
  const leaseToken = randomUUID()
  const claim = await claimBillingWebhookEvent({ eventId, leaseToken, leaseSeconds: 90, allowReclaim: true, now })
  if (!claim.claimed) return claim.status
  try {
    const event = claim.payload as PaddleEvent
    let status: "processed" | "ignored"
    if (event.eventType === "transaction.completed" && (event.origin === "subscription_recurring" || event.origin === "subscription_update") && event.subscriptionId) {
      const result = await reconcilePaddleSubscription(event.subscriptionId, undefined, event)
      status = result.status
    } else if (event.eventType === "transaction.created" && event.origin === "api") {
      status = await getVerifiedPaddleCheckout(event.objectId, undefined, true) ? "processed" : "ignored"
    } else if (isPaddleCheckoutEvent(event.eventType) && event.origin === "api") {
      const result = await reconcilePaddleCheckoutSession(event.objectId, undefined, event)
      if (result.status === "pending") throw new Error("Paddle transaction is still being confirmed.")
      status = result.workspaceId ? "processed" : "ignored"
    } else if (isPaddleSubscriptionEvent(event.eventType)) {
      const result = await reconcilePaddleSubscription(event.objectId, undefined, event)
      status = result.status
    } else {
      status = "ignored"
    }
    await finalizeBillingWebhookEvent({ eventId, leaseToken, status, now })
    return status
  } catch (error) {
    const errorCode = error instanceof BillingProjectionError ? error.code : "PADDLE_RECONCILIATION_FAILED"
    const nextAttemptAt = claim.attempts < claim.max_attempts
      ? new Date(now.getTime() + Math.min(3600, 30 * 2 ** Math.max(0, claim.attempts - 1)) * 1000)
      : null
    await finalizeBillingWebhookEvent({
      eventId, leaseToken, status: "failed", errorCode, nextAttemptAt, now,
    })
    return "failed"
  }
}
