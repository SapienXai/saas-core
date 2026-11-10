import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"
import { BillingConfigurationError } from "../config"
import type { BillingProviderAdapter, ProviderCheckoutSession, ProviderSubscriptionSnapshot } from "../provider"

const apiOrigin = "https://sandbox-api.paddle.com"
const provider = "paddle"
const environment = "sandbox" as const

function loopbackOrigin(value: string | undefined) {
  try {
    const url = new URL(value || "")
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol === "http:" ? url.origin : null
  } catch {
    return null
  }
}

export function getPaddleSandboxConfig() {
  const apiKey = process.env.PADDLE_API_KEY?.trim()
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim()
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET?.trim()
  const siteOrigin = loopbackOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  if (process.env.NODE_ENV !== "development" || process.env.SAAS_CORE_BILLING_PROVIDER !== provider ||
      process.env.SAAS_CORE_BILLING_MODE !== "enabled" ||
      process.env.PADDLE_ENVIRONMENT !== environment || !siteOrigin ||
      !loopbackOrigin(process.env.SUPABASE_URL) || !loopbackOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
      !apiKey?.startsWith("pdl_sdbx_") || !clientToken?.startsWith("test_") || !webhookSecret) {
    throw new BillingConfigurationError("Paddle checkout requires a local Paddle Sandbox configuration.")
  }
  return { apiKey, clientToken, webhookSecret, siteOrigin, environment }
}

type PaddlePrice = {
  id: string
  product_id: string
  status: string
  unit_price: { amount: string; currency_code: string }
  billing_cycle: { interval: string; frequency: number } | null
}
type PaddleItem = { price: Pick<PaddlePrice, "id" | "product_id">; quantity: number }
type PaddleTransaction = {
  id: string
  status: string
  customer_id: string | null
  subscription_id: string | null
  custom_data: Record<string, unknown> | null
  items: PaddleItem[]
}
type PaddleSubscription = {
  id: string
  status: string
  customer_id: string
  next_billed_at: string | null
  current_billing_period: { starts_at: string; ends_at: string } | null
  scheduled_change: { action: string; effective_at: string } | null
  custom_data: Record<string, unknown> | null
  items: PaddleItem[]
}

export function isPaddleTransactionId(id: string) {
  return /^txn_[a-z0-9]{26}$/.test(id)
}

function paddlePath(kind: "prices" | "transactions" | "subscriptions", id: string) {
  const prefixes = { prices: "pri", transactions: "txn", subscriptions: "sub" }
  if (!new RegExp(`^${prefixes[kind]}_[a-z0-9]{26}$`).test(id)) throw new Error("Invalid Paddle reference.")
  return `/${kind}/${id}`
}

async function paddleRequest<T>(path: string, body?: object, method = "GET"): Promise<T> {
  const { apiKey } = getPaddleSandboxConfig()
  const response = await fetch(apiOrigin + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Paddle-Version": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Paddle Sandbox request failed (${response.status}).`)
  const result = await response.json() as { data?: T }
  if (!result.data) throw new Error("Paddle Sandbox returned no data.")
  return result.data
}

function stringMetadata(data: Record<string, unknown> | null) {
  return Object.fromEntries(Object.entries(data || {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

export function getPaddleReturnPath(value: string | undefined, siteOrigin: string, transactionId: string, completed: boolean) {
  const fallback = new URL("/manage/plan", siteOrigin)
  let url = fallback
  try {
    const candidate = new URL(value || fallback.href, siteOrigin)
    if (candidate.origin === siteOrigin && !candidate.username && !candidate.password &&
        !candidate.pathname.startsWith("//") && !candidate.pathname.includes("\\")) url = candidate
  } catch { /* Use the billing screen. */ }
  url.searchParams.delete("checkout_session_id")
  url.searchParams.delete("checkout")
  if (completed) url.searchParams.set("checkout_session_id", transactionId)
  else url.searchParams.set("checkout", "cancelled")
  return url.pathname + url.search + url.hash
}

function checkoutSnapshot(transaction: PaddleTransaction): ProviderCheckoutSession {
  const metadata = stringMetadata(transaction.custom_data)
  const open = transaction.status === "draft" || transaction.status === "ready"
  return {
    id: transaction.id,
    url: open && isPaddleTransactionId(transaction.id) ? "/billing/paddle/checkout?transaction=" + transaction.id : null,
    livemode: false,
    status: open ? "open" : transaction.status === "completed" ? "complete" : transaction.status === "canceled" ? "expired" : "unknown",
    paymentStatus: transaction.status === "completed" || transaction.status === "paid" ? "paid" : open || transaction.status === "canceled" ? "unpaid" : "unknown",
    customerId: transaction.customer_id,
    subscriptionId: transaction.subscription_id,
    workspaceId: metadata.workspace_id || null,
    mutationId: metadata.billing_mutation_id || null,
    metadata,
  }
}

export async function retrievePaddleTransaction(id: string) {
  const transaction = await paddleRequest<PaddleTransaction>(paddlePath("transactions", id))
  if (transaction.id !== id) throw new Error("Paddle returned another transaction.")
  return { session: checkoutSnapshot(transaction), items: transaction.items }
}

export async function retrievePaddleSubscription(id: string): Promise<ProviderSubscriptionSnapshot> {
  const subscription = await paddleRequest<PaddleSubscription>(paddlePath("subscriptions", id))
  const item = subscription.items.length === 1 ? subscription.items[0] : null
  if (!item?.price || item.quantity !== 1) throw new Error("Unsupported Paddle subscription items.")
  const status = subscription.status
  const cancelEffectiveAt = subscription.scheduled_change?.action === "cancel" ? subscription.scheduled_change.effective_at : null
  return {
    id: subscription.id,
    status: status === "active" || status === "trialing" || status === "past_due" || status === "paused" || status === "canceled" ? status : "unpaid",
    providerStatus: status,
    issueCode: null,
    livemode: false,
    customerId: subscription.customer_id,
    nextBilledAt: subscription.next_billed_at,
    currentBillingPeriod: subscription.current_billing_period
      ? { startsAt: subscription.current_billing_period.starts_at, endsAt: subscription.current_billing_period.ends_at }
      : null,
    cancelAtPeriodEnd: Boolean(cancelEffectiveAt),
    cancelEffectiveAt,
    hasPendingUpdate: false,
    scheduleId: null,
    scheduledPlan: null,
    collectionPaused: status === "paused",
    customData: stringMetadata(subscription.custom_data),
    items: [{ id: item.price.id, priceId: item.price.id, productId: item.price.product_id, quantity: item.quantity }],
  }
}

export function verifyPaddleSandboxWebhook(rawBody: string, signature: string, secret: string, now = Date.now()) {
  const parts = signature.split(";").map(part => part.trim())
  const timestamps = parts.filter(part => /^ts=\d+$/.test(part))
  if (timestamps.length !== 1) throw new Error("Invalid Paddle signature.")
  const timestamp = timestamps[0].slice(3)
  if (Math.abs(now - Number(timestamp) * 1000) > 5000) throw new Error("Expired Paddle signature.")
  const expected = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest()
  const valid = parts.some(part => /^h1=[a-f0-9]{64}$/i.test(part) &&
    timingSafeEqual(expected, Buffer.from(part.slice(3), "hex")))
  if (!valid) throw new Error("Invalid Paddle signature.")
  return JSON.parse(rawBody) as unknown
}

function unsupported(): never {
  throw new BillingConfigurationError("This subscription action is unavailable in the Paddle checkout pilot.")
}

export function createPaddleSandboxAdapter(): BillingProviderAdapter {
  const config = getPaddleSandboxConfig()
  return {
    provider,
    environment,
    async createCheckoutSession(request) {
      const transaction = await paddleRequest<PaddleTransaction>("/transactions", {
        items: [{ price_id: request.priceId, quantity: 1 }],
        collection_mode: "automatic",
        custom_data: {
          workspace_id: request.workspaceId,
          billing_mutation_id: request.mutationId,
          billing_provider: provider,
          billing_environment: environment,
          plan_key: request.planKey,
          billing_interval: request.interval,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
        },
      }, "POST")
      return checkoutSnapshot(transaction)
    },
    async retrieveCheckoutSession(id) {
      return (await retrievePaddleTransaction(id)).session
    },
    async expireCheckoutSession(id) {
      const { session } = await retrievePaddleTransaction(id)
      if (session.status !== "open" || session.paymentStatus !== "unpaid" || session.subscriptionId) return session
      const transaction = await paddleRequest<PaddleTransaction>(paddlePath("transactions", id), { status: "canceled" }, "PATCH")
      return checkoutSnapshot(transaction)
    },
    retrieveSubscription: retrievePaddleSubscription,
    async retrievePrice(id) {
      const price = await paddleRequest<PaddlePrice>(paddlePath("prices", id))
      if (price.id !== id || price.status !== "active") throw new Error("Paddle price is unavailable.")
      return {
        id: price.id, productId: price.product_id, amount: Number(price.unit_price.amount), currency: price.unit_price.currency_code,
        interval: price.billing_cycle?.interval ?? null, intervalCount: price.billing_cycle?.frequency ?? null, livemode: false,
      }
    },
    async verifyWebhook(rawBody, signature) {
      return verifyPaddleSandboxWebhook(rawBody, signature, config.webhookSecret)
    },
    async getCustomerPaymentMethod() { return null },
    async listInvoices() { return [] },
    retrieveInvoice: unsupported,
    createPortalSession: unsupported,
    previewSubscriptionChange: unsupported,
    updateSubscriptionPrice: unsupported,
    schedulePlanChange: unsupported,
    releaseSchedule: unsupported,
    scheduleCancellation: unsupported,
    undoScheduledCancellation: unsupported,
  }
}
