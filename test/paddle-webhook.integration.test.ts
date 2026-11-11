import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { normalizePaddleEvent, processStoredPaddleWebhookEvent, reconcilePaddleCheckoutSession, recordPaddleEvent } from "@/lib/billing/paddle-webhook"
import { recordBillingMutationTransition } from "@/lib/billing/persistence"

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function paddleId(prefix: string) {
  return prefix + "_" + randomUUID().replaceAll("-", "").slice(0, 26)
}

describe.skipIf(url !== "http://127.0.0.1:55621" || !serviceKey)("Paddle webhook reconciliation with local Supabase", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("recovers one checkout, verifies payment and renewal, and rejects stale or forged changes", async () => {
    for (const [name, value] of Object.entries({
      NODE_ENV: "development",
      SAAS_CORE_BILLING_PROVIDER: "paddle",
      SAAS_CORE_BILLING_MODE: "enabled",
      PADDLE_ENVIRONMENT: "sandbox",
      PADDLE_API_KEY: "pdl_sdbx_fixture",
      PADDLE_WEBHOOK_SECRET: "fixture-secret",
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_fixture",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
    })) vi.stubEnv(name, value)

    const db = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
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
      const mutation = await db.from("billing_mutations").insert({
        workspace_id: workspaceId, request_key: randomUUID(), status: "unknown", operation: "checkout",
        result: { checkoutPriceId: priceId, interval: "month" },
      }).select("id").single()
      if (mutation.error) throw mutation.error
      const mutationId = mutation.data.id
      await recordBillingMutationTransition({
        mutationId, workspaceId, provider: "paddle", environment: "sandbox",
        transitionKey: "checkout:" + mutationId, kind: "checkout", toPlanKey: planKey,
      })
      const metadata = {
        workspace_id: workspaceId, billing_provider: "paddle", billing_environment: "sandbox",
        billing_mutation_id: mutationId, billing_checkout_mutation_id: mutationId,
        plan_key: planKey, billing_interval: "month",
      }
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
        if (address.pathname === "/transactions/" + transactionId) return Response.json({ data: transaction })
        if (address.pathname === "/subscriptions/" + subscriptionId) return Response.json({ data: remote })
        if (address.pathname === "/transactions") return Response.json({ data: renewals })
        throw new Error("Unexpected Paddle fixture request")
      }))
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
      await expect(reconcilePaddleCheckoutSession(transactionId, workspaceId)).resolves.toMatchObject({ status: "pending" })
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
})
