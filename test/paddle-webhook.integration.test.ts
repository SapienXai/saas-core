import { randomUUID } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { createClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cancelSubscription, getPlanUsage, startCheckout } from "@/app/manage/plan/actions"
import { getCurrentWorkspace, requireWorkspaceRole } from "@/lib/authorization"
import * as stripe from "@/lib/billing/providers/stripe"
import { reconcileBillingCheckoutSession, reconcileBillingSubscription } from "@/lib/billing/reconciliation-service"
import { normalizePaddleEvent, processStoredPaddleWebhookEvent, reconcilePaddleCheckoutSession, recordPaddleEvent } from "@/lib/billing/paddle-webhook"
import { applyProviderSubscriptionProjection, settleProviderMutation } from "@/lib/billing/subscription-projection"
import type { BillingProviderAdapter, ProviderCheckoutSession, ProviderSubscriptionSnapshot } from "@/lib/billing/provider"
import { recordBillingMutationTransition } from "@/lib/billing/persistence"
import { normalizeStripeEvent, processStoredStripeWebhookEvent, recordStripeWebhookEvent } from "@/lib/billing/stripe-webhook"

vi.mock("@/lib/authorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/authorization")>(),
  getCurrentWorkspace: vi.fn(),
  requireWorkspaceRole: vi.fn(),
  requireUser: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

function signInAsOwner(workspaceId: string) {
  vi.mocked(getCurrentWorkspace).mockResolvedValue({ workspace_id: workspaceId, role: "owner" } as Awaited<ReturnType<typeof getCurrentWorkspace>>)
}

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const localNeon = process.env.NEXT_PUBLIC_SAAS_CORE_BACKEND === "neon" &&
  /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(process.env.NEON_DATA_API_URL || "")
const localSupabase = url === "http://127.0.0.1:55621" && Boolean(serviceKey)

function fixtureDatabase() {
  return localNeon
    ? createServiceRoleClient()
    : createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
}

function configurePaddleCheckout() {
  vi.stubEnv("SAAS_CORE_BILLING_PROVIDER", undefined)
  for (const [name, value] of Object.entries({
    NODE_ENV: "development",
    SAAS_CORE_BILLING_MODE: "enabled",
    PADDLE_ENVIRONMENT: "sandbox",
    PADDLE_API_KEY: "pdl_sdbx_fixture",
    PADDLE_WEBHOOK_SECRET: "fixture-secret",
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_fixture",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
  })) vi.stubEnv(name, value)
}

function paddleId(prefix: string) {
  return prefix + "_" + randomUUID().replaceAll("-", "").slice(0, 26)
}

describe.skipIf(!localNeon && !localSupabase)("Provider checkout and webhook reconciliation with local Postgres", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("starts new checkout through Paddle, recovers a lost response, and verifies payment and renewal", async () => {
    configurePaddleCheckout()

    const db = fixtureDatabase()
    const fixture = randomUUID().slice(0, 8)
    const planKey = "paddle-proof-" + fixture
    const priceId = paddleId("pri")
    const productId = paddleId("pro")
    const transactionId = paddleId("txn")
    const subscriptionId = paddleId("sub")
    const customerId = paddleId("ctm")
    const received: string[] = []
    const { data: workspace, error: workspaceError } = await db.from("workspaces")
      .insert({ name: "Paddle proof", slug: planKey }).select("id").single()
    if (workspaceError) throw workspaceError
    const workspaceId = workspace.id
    try {
      const plan = await db.from("plans").insert({ key: planKey, name: "Paid fixture", sort_order: 50, active: true, limits: { projects: 5 } })
      expect(plan.error).toBeNull()
      const mapping = await db.from("billing_provider_prices").insert({
        provider: "paddle", environment: "sandbox", provider_price_id: priceId, provider_product_id: productId,
        plan_key: planKey, currency: "USD", billing_interval: "month", active: true,
      })
      expect(mapping.error).toBeNull()
      signInAsOwner(workspaceId)
      let metadata: Record<string, string> = {}
      let createCalls = 0
      const items = [{ price: { id: priceId, product_id: productId }, quantity: 1 }]
      const initialPeriod = {
        starts_at: new Date(Date.now() - 120_000).toISOString(),
        ends_at: new Date(Date.now() - 60_000).toISOString(),
      }
      const renewalPeriod = {
        starts_at: initialPeriod.ends_at,
        ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      }
      let transaction = { id: transactionId, origin: "web", status: "ready", custom_data: metadata, items, customer_id: null as string | null, subscription_id: null as string | null }
      let remote = {
        id: subscriptionId, status: "active", customer_id: customerId, items, custom_data: metadata,
        current_billing_period: initialPeriod, next_billed_at: initialPeriod.ends_at, collection_mode: "automatic",
      }
      let renewals: unknown[] = []
      const realFetch = globalThis.fetch
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const address = new URL(input instanceof Request ? input.url : input)
        if (address.origin !== "https://sandbox-api.paddle.com") return realFetch(input, init)
        if (address.pathname === "/prices/" + priceId) {
          return Response.json({ data: { id: priceId, product_id: productId, status: "active", unit_price: { amount: "990", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } } })
        }
        if (address.pathname === "/transactions" && init?.method === "POST") {
          createCalls += 1
          const body = JSON.parse(String(init.body))
          expect(body.items).toEqual([{ price_id: priceId, quantity: 1 }])
          metadata = body.custom_data
          transaction = { ...transaction, custom_data: metadata }
          remote = { ...remote, custom_data: metadata }
          throw new Error("Fixture lost the response after creating the Paddle transaction.")
        }
        if (address.pathname === "/transactions/" + transactionId) return Response.json({ data: transaction })
        if (address.pathname === "/subscriptions/" + subscriptionId) return Response.json({ data: remote })
        if (address.pathname === "/transactions") return Response.json({ data: renewals })
        throw new Error("Unexpected Paddle fixture request")
      }))
      await expect(startCheckout(planKey, "month")).resolves.toMatchObject({ success: false })
      expect(createCalls).toBe(1)
      expect(metadata).toMatchObject({ workspace_id: workspaceId, billing_provider: "paddle", billing_environment: "sandbox", plan_key: planKey, billing_interval: "month" })
      expect(requireWorkspaceRole).toHaveBeenCalledWith(workspaceId, ["owner"])
      const mutationId = metadata.billing_mutation_id
      for (const scope of [
        { workspaceId, provider: "stripe", environment: "sandbox" },
        { workspaceId, provider: "paddle", environment: "live" },
        { workspaceId: randomUUID(), provider: "paddle", environment: "sandbox" },
      ] as const) {
        await settleProviderMutation(db, scope, mutationId, "expired", planKey, transactionId)
      }
      const unsettled = await db.from("billing_mutations").select("status").eq("id", mutationId).single()
      expect(unsettled.data?.status).toBe("unknown")
      const processEvent = async (eventType: string, objectId: string, occurredAt: string, origin?: string) => {
        const event = normalizePaddleEvent({
          event_id: paddleId("evt"), event_type: eventType, occurred_at: occurredAt,
          data: { id: objectId, origin, subscription_id: subscriptionId },
        })
        const receipt = await recordPaddleEvent(event)
        received.push(receipt.id)
        const duplicate = await recordPaddleEvent(event)
        expect(duplicate.id).toBe(receipt.id)
        return { id: receipt.id, status: await processStoredPaddleWebhookEvent(receipt.id) }
      }
      const projected = async () => {
        const row = await db.from("workspace_subscriptions").select("*").eq("workspace_id", workspaceId).single()
        if (row.error) throw row.error
        return row.data
      }

      expect((await processEvent("transaction.created", transactionId, initialPeriod.starts_at, "api")).status).toBe("ignored")
      expect((await projected()).source).toBe("system")
      transaction = { ...transaction, origin: "api" }
      expect((await processEvent("transaction.created", transactionId, initialPeriod.starts_at, "api")).status).toBe("processed")
      await expect(reconcilePaddleCheckoutSession(transactionId, randomUUID())).resolves.toMatchObject({ status: "failed" })
      await expect(reconcileBillingCheckoutSession(transactionId, workspaceId)).resolves.toMatchObject({ status: "pending" })
      expect((await projected()).source).toBe("system")

      transaction = { ...transaction, status: "completed", customer_id: customerId, subscription_id: subscriptionId }
      const paid = await processEvent("transaction.completed", transactionId, initialPeriod.starts_at, "api")
      expect(paid.status).toBe("processed")
      await expect(processStoredPaddleWebhookEvent(paid.id)).resolves.toBe("processed")
      expect(await projected()).toMatchObject({ provider: "paddle", status: "active", plan_key: planKey, provider_subscription_id: subscriptionId })
      const settled = await db.from("billing_mutations").select("status").eq("id", mutationId).single()
      expect(settled.data?.status).toBe("succeeded")

      remote = { ...remote, current_billing_period: renewalPeriod, next_billed_at: renewalPeriod.ends_at }
      const pending = await processEvent("subscription.updated", subscriptionId, renewalPeriod.starts_at)
      expect(pending.status).toBe("failed")
      const retry = await db.from("billing_webhook_events").select("attempts,next_attempt_at,last_error_code").eq("id", pending.id).single()
      expect(retry.data).toMatchObject({ attempts: 1, last_error_code: "RENEWAL_PENDING_PAYMENT" })
      expect(retry.data?.next_attempt_at).toBeTruthy()
      expect(Date.parse((await projected()).current_period_end_at)).toBe(Date.parse(initialPeriod.ends_at))

      renewals = [{ origin: "subscription_recurring", status: "completed", customer_id: customerId, subscription_id: subscriptionId, billing_period: renewalPeriod, items }]
      expect((await processEvent("transaction.completed", paddleId("txn"), renewalPeriod.starts_at, "subscription_recurring")).status).toBe("processed")
      expect(Date.parse((await projected()).current_period_end_at)).toBe(Date.parse(renewalPeriod.ends_at))

      remote = { ...remote, custom_data: { ...metadata, workspace_id: randomUUID() } }
      expect((await processEvent("subscription.updated", subscriptionId, new Date().toISOString())).status).toBe("failed")
      expect((await projected()).provider_subscription_id).toBe(subscriptionId)
      remote = { ...remote, status: "canceled", custom_data: metadata }
      const canceledAt = new Date().toISOString()
      expect((await processEvent("subscription.canceled", subscriptionId, canceledAt)).status).toBe("processed")
      expect((await processEvent("subscription.activated", subscriptionId, initialPeriod.starts_at)).status).toBe("processed")
      expect(await projected()).toMatchObject({ status: "canceled" })
      expect(Date.parse((await projected()).last_provider_event_at)).toBe(Date.parse(canceledAt))
      await expect(reconcilePaddleCheckoutSession(transactionId, workspaceId)).resolves.toMatchObject({ status: "failed" })
    } finally {
      if (received.length) await db.from("billing_webhook_events").delete().in("id", received)
      await db.from("workspaces").delete().eq("id", workspaceId)
      await db.from("billing_provider_prices").delete().eq("provider_price_id", priceId)
      await db.from("plans").delete().eq("key", planKey)
    }
  })

  it("verifies Stripe renewal and schedules cancellation with Stripe while new checkout uses Paddle", async () => {
    configurePaddleCheckout()
    vi.stubEnv("STRIPE_ENVIRONMENT", "sandbox")
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture")
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fixture")
    vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_fixture")
    vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "bpc_fixture")
    const db = fixtureDatabase()
    const fixture = randomUUID().slice(0, 8)
    const planKey = "stripe-proof-" + fixture
    const priceId = "price_" + fixture
    const productId = "prod_" + fixture
    const checkoutId = "cs_test_" + fixture
    const subscriptionId = "sub_" + fixture
    const customerId = "cus_" + fixture
    const workspace = await db.from("workspaces").insert({ name: "Stripe projection proof", slug: planKey }).select("id").single()
    if (workspace.error) throw workspace.error
    const workspaceId = workspace.data.id
    let webhookReceiptId: string | undefined
    try {
      const plan = await db.from("plans").insert({ key: planKey, name: "Stripe paid fixture", sort_order: 50, active: true })
      expect(plan.error).toBeNull()
      const mapping = await db.from("billing_provider_prices").insert({
        provider: "stripe", environment: "sandbox", provider_price_id: priceId, provider_product_id: productId,
        plan_key: planKey, currency: "USD", billing_interval: "month", active: true,
      })
      expect(mapping.error).toBeNull()
      const mutation = await db.from("billing_mutations").insert({
        workspace_id: workspaceId, request_key: randomUUID(), status: "pending", operation: "checkout",
      }).select("id").single()
      if (mutation.error) throw mutation.error
      const mutationId = mutation.data.id
      await recordBillingMutationTransition({
        mutationId, workspaceId, provider: "stripe", environment: "sandbox",
        transitionKey: "checkout:" + mutationId, kind: "checkout", toPlanKey: planKey,
      })
      const checkout = await db.from("billing_checkout_sessions").insert({
        workspace_id: workspaceId, provider: "stripe", environment: "sandbox", target_plan_key: planKey,
        provider_price_id: priceId, provider_transaction_id: checkoutId, idempotency_key: mutationId, status: "created",
      })
      expect(checkout.error).toBeNull()
      const metadata = {
        workspace_id: workspaceId, billing_provider: "stripe", billing_environment: "sandbox",
        billing_mutation_id: mutationId, plan_key: planKey, billing_interval: "month",
      }
      const now = new Date().toISOString()
      const subscription: ProviderSubscriptionSnapshot = {
        id: subscriptionId, customerId, status: "active", providerStatus: "active", issueCode: null, livemode: false,
        nextBilledAt: null, currentBillingPeriod: { startsAt: now, endsAt: new Date(Date.now() + 86_400_000).toISOString() },
        cancelAtPeriodEnd: false, cancelEffectiveAt: null, hasPendingUpdate: false, scheduleId: null, scheduledPlan: null,
        collectionPaused: false, customData: metadata, items: [{ id: "si_" + fixture, priceId, productId, quantity: 1 }],
      }
      const session: ProviderCheckoutSession = {
        id: checkoutId, url: null, livemode: false, status: "complete", paymentStatus: "paid", customerId, subscriptionId,
        workspaceId, mutationId, metadata,
      }
      const adapter = {
        provider: "stripe", environment: "sandbox" as const,
        retrieveSubscription: vi.fn().mockResolvedValue(subscription), retrieveCheckoutSession: vi.fn(), hasPaidRenewal: vi.fn(),
      }
      const retrievePrice = vi.fn().mockResolvedValue({ id: priceId, productId, amount: 990, currency: "USD", interval: "month", intervalCount: 1, livemode: false })
      const scheduleCancellation = vi.fn(async (id: string, mutationId: string) => {
        expect(id).toBe(subscriptionId)
        const current = await adapter.retrieveSubscription(id)
        const canceled = {
          ...current, cancelAtPeriodEnd: true, cancelEffectiveAt: current.currentBillingPeriod.endsAt,
          customData: { ...current.customData, billing_mutation_id: mutationId, billing_mutation_kind: "cancel" },
        }
        adapter.retrieveSubscription.mockResolvedValue(canceled)
        return canceled
      })
      const stripeFactory = vi.spyOn(stripe, "createStripeBillingAdapter").mockReturnValue({
        ...adapter, retrievePrice, scheduleCancellation, getCustomerPaymentMethod: vi.fn().mockResolvedValue(null),
      } as unknown as BillingProviderAdapter)
      signInAsOwner(workspaceId)
      const event = { eventId: "evt_" + fixture, occurredAt: now, workspaceId, eventType: "customer.subscription.created" }
      for (const change of [
        { paymentStatus: "unpaid" }, { id: checkoutId + "_foreign" }, { customerId: "cus_other" }, { subscriptionId: "sub_other" },
        { workspaceId: randomUUID() }, { mutationId: randomUUID() }, { livemode: true }, { metadata: { ...metadata, billing_interval: "year" } },
      ]) {
        adapter.retrieveCheckoutSession.mockResolvedValue({ ...session, ...change })
        await expect(applyProviderSubscriptionProjection(event, subscriptionId, adapter)).rejects.toMatchObject({ code: "CHECKOUT_PAYMENT_UNVERIFIED" })
      }
      expect(adapter.retrieveCheckoutSession).toHaveBeenCalledWith(checkoutId)
      const unchanged = await db.from("workspace_subscriptions").select("source").eq("workspace_id", workspaceId).single()
      expect(unchanged.data?.source).toBe("system")
      adapter.retrieveCheckoutSession.mockResolvedValue(session)
      await expect(applyProviderSubscriptionProjection(event, subscriptionId, adapter)).resolves.toMatchObject({ status: "processed", planKey })
      expect(adapter.hasPaidRenewal).not.toHaveBeenCalled()

      const renewedPeriod = { startsAt: now, endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }
      adapter.retrieveSubscription.mockResolvedValue({ ...subscription, currentBillingPeriod: renewedPeriod })
      adapter.hasPaidRenewal.mockResolvedValue(false)
      const projectedEnd = async () => {
        const row = await db.from("workspace_subscriptions").select("current_period_end_at").eq("workspace_id", workspaceId).single()
        if (row.error) throw row.error
        return Date.parse(row.data.current_period_end_at)
      }
      await expect(reconcileBillingSubscription(subscriptionId, randomUUID())).rejects.toThrow("not linked")
      vi.stubEnv("STRIPE_ENVIRONMENT", "live")
      await expect(reconcileBillingSubscription(subscriptionId, workspaceId)).rejects.toThrow("environment does not match")
      expect(stripeFactory).not.toHaveBeenCalled()
      vi.stubEnv("STRIPE_ENVIRONMENT", "sandbox")
      await expect(reconcileBillingCheckoutSession(checkoutId, randomUUID())).resolves.toMatchObject({ status: "failed" })
      await expect(reconcileBillingCheckoutSession(checkoutId, workspaceId)).resolves.toMatchObject({ status: "processed", planKey })
      await expect(reconcileBillingSubscription(subscriptionId, workspaceId)).rejects.toMatchObject({ code: "RENEWAL_PENDING_PAYMENT" })
      expect(await projectedEnd()).toBe(Date.parse(subscription.currentBillingPeriod!.endsAt))

      adapter.hasPaidRenewal.mockResolvedValue(true)
      const receipt = await recordStripeWebhookEvent(normalizeStripeEvent({
        id: "evt_paid_" + fixture, type: "invoice.paid", created: Math.floor(Date.now() / 1000), livemode: false,
        data: { object: { id: "in_" + fixture, object: "invoice", subscription: subscriptionId } },
      }))
      webhookReceiptId = receipt.id
      await expect(processStoredStripeWebhookEvent(receipt.id)).resolves.toBe("processed")
      await expect(reconcileBillingSubscription(subscriptionId, workspaceId)).resolves.toMatchObject({ status: "processed", planKey })
      expect(await projectedEnd()).toBe(Date.parse(renewedPeriod.endsAt))

      await expect(getPlanUsage()).resolves.toMatchObject({
        success: true, data: { billing: { canStartCheckout: false, isProviderBacked: true, canManageProvider: true, canUsePortal: true } },
      })
      await expect(cancelSubscription("other")).resolves.toMatchObject({ success: true })
      expect(requireWorkspaceRole).toHaveBeenCalledWith(workspaceId, ["owner"])
      expect(scheduleCancellation).toHaveBeenCalledTimes(1)
      const recorded = await db.from("billing_mutation_transitions").select("provider, environment, state")
        .eq("workspace_id", workspaceId).eq("kind", "cancel").single()
      expect(recorded.data).toEqual({ provider: "stripe", environment: "sandbox", state: "succeeded" })
      const afterCancel = await db.from("workspace_subscriptions").select("provider, cancel_at_period_end, current_period_end_at").eq("workspace_id", workspaceId).single()
      expect(afterCancel.data).toMatchObject({ provider: "stripe", cancel_at_period_end: true })
      expect(await projectedEnd()).toBe(Date.parse(renewedPeriod.endsAt))
    } finally {
      if (webhookReceiptId) await db.from("billing_webhook_events").delete().eq("id", webhookReceiptId)
      await db.from("workspaces").delete().eq("id", workspaceId)
      await db.from("billing_provider_prices").delete().eq("provider_price_id", priceId)
      await db.from("plans").delete().eq("key", planKey)
    }
  })
})
