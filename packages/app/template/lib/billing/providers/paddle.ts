import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { BillingConfigurationError, BillingMutationRejectedError, BillingScheduleUnavailableError, assertBillingMutationsEnabled, isBillingDeferred } from "../config"
import { getProviderPriceByProviderId } from "../price-mapping"
import type { BillingProviderAdapter, BillingProviderEnvironment, ProviderCheckoutSession, ProviderInvoiceSummary, ProviderSubscriptionSnapshot } from "../provider"

const provider = "paddle"
const checkoutPath = "/billing/paddle/checkout"

function configuredOrigin(value: string | undefined, environment: BillingProviderEnvironment) {
  try {
    const url = new URL(value || "")
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    return (environment === "sandbox" ? loopback && url.protocol === "http:" : !loopback && url.protocol === "https:" && !url.port)
      ? url.origin : null
  } catch {
    return null
  }
}

export function getPaddleConfig() {
  const environment = process.env.PADDLE_ENVIRONMENT
  const apiKey = process.env.PADDLE_API_KEY?.trim()
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim()
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET?.trim()
  if (process.env.SAAS_CORE_BILLING_PROVIDER !== provider || (environment !== "sandbox" && environment !== "live")) {
    throw new BillingConfigurationError("Paddle environment is not configured.")
  }
  const live = environment === "live"
  const hosted = live || process.env.NODE_ENV === "production"
  const originEnvironment = hosted ? "live" : "sandbox"
  const siteOrigin = configuredOrigin(hosted ? process.env.PADDLE_APP_ORIGIN : process.env.NEXT_PUBLIC_SITE_URL, originEnvironment)
  const accountId = process.env.PADDLE_ACCOUNT_ID?.trim()
  if (!siteOrigin || !webhookSecret || !apiKey?.startsWith(live ? "pdl_live_" : "pdl_sdbx_") ||
      !clientToken?.startsWith(live ? "live_" : "test_")) {
    throw new BillingConfigurationError("Paddle credentials or checkout origin do not match the environment.")
  }
  if (hosted ? process.env.NODE_ENV !== "production" ||
      (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") ||
      siteOrigin !== configuredOrigin(process.env.APP_URL, "live") ||
      !configuredOrigin(process.env.SUPABASE_URL, "live") ||
      configuredOrigin(process.env.SUPABASE_URL, "live") !== configuredOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL, "live") ||
      (live && !/^slr_[a-z0-9]{26}$/.test(accountId || ""))
    : process.env.NODE_ENV !== "development" || process.env.SAAS_CORE_BILLING_MODE !== "enabled" ||
      !configuredOrigin(process.env.SUPABASE_URL, environment) || !configuredOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL, environment)) {
    throw new BillingConfigurationError("Paddle configuration does not match this deployment.")
  }
  return {
    apiKey, clientToken, webhookSecret, siteOrigin, environment, accountId,
    apiOrigin: live ? "https://api.paddle.com" : "https://sandbox-api.paddle.com",
  } as const
}

export function canStartPaddleCheckout(workspaceId: string) {
  const { environment } = getPaddleConfig()
  if (isBillingDeferred()) return false
  if (environment === "sandbox") return true
  return process.env.PADDLE_LIVE_CHECKOUT_MODE === "enabled" ||
    (process.env.PADDLE_LIVE_CHECKOUT_MODE === "pilot" && process.env.PADDLE_LIVE_CHECKOUT_WORKSPACE_ID === workspaceId)
}

type PaddleConfig = ReturnType<typeof getPaddleConfig>
type PaddleApiRoot = { api: { environment: string }; caller: { auth_type: string; account: { id: string } | null } }
let liveAccountVerification: { key: string; accountId: string; result: Promise<void> } | undefined

async function assertPaddleLiveAccount(config: PaddleConfig) {
  const accountId = config.accountId
  if (config.environment !== "live" || !accountId) return
  if (liveAccountVerification?.key === config.apiKey && liveAccountVerification.accountId === accountId) {
    return liveAccountVerification.result
  }
  const result = sendPaddleRequest<PaddleApiRoot>(config, "/").then(data => {
    if (data.api.environment !== "production" || data.caller.auth_type !== "api_key" || data.caller.account?.id !== accountId) {
      throw new BillingConfigurationError("Paddle API key belongs to another account.", "BILLING_ACCOUNT_MISMATCH")
    }
  })
  liveAccountVerification = { key: config.apiKey, accountId, result }
  try {
    await result
  } catch (error) {
    if (liveAccountVerification?.result === result) liveAccountVerification = undefined
    throw error
  }
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
  origin: string
  billing_period: { starts_at: string; ends_at: string } | null
  currency_code: string
  created_at: string
  billed_at: string | null
  invoice_number: string | null
  details?: { totals?: PaddleTotals }
}
type PaddleTotals = { total?: string; grand_total?: string; balance?: string; credit_to_balance?: string; currency_code?: string }
type PaddleSubscription = {
  id: string
  status: string
  customer_id: string
  collection_mode: string
  paused_at: string | null
  next_billed_at: string | null
  current_billing_period: { starts_at: string; ends_at: string } | null
  scheduled_change: { action: string; effective_at: string; resume_at?: string | null } | null
  custom_data: Record<string, unknown> | null
  items: Array<{ price: PaddlePrice; quantity: number }>
  currency_code: string
}
type PaddlePreview = PaddleSubscription & {
  immediate_transaction: { details: { totals: PaddleTotals } } | null
  next_transaction: { details: { totals: PaddleTotals } } | null
  recurring_transaction_details: { totals: PaddleTotals } | null
  update_summary: { result?: { action: string; amount: string; currency_code: string } } | null
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
  const config = getPaddleConfig()
  await assertPaddleLiveAccount(config)
  return sendPaddleRequest<T>(config, path, body, method)
}

async function sendPaddleRequest<T>({ apiOrigin, apiKey }: PaddleConfig, path: string, body?: object, method = "GET"): Promise<T> {
  const updatesSubscription = method === "PATCH" && /^\/subscriptions\/sub_[a-z0-9]{26}$/.test(path)
  const pausesSubscription = method === "POST" && /^\/subscriptions\/sub_[a-z0-9]{26}\/pause$/.test(path)
  const resumesSubscription = method === "POST" && /^\/subscriptions\/sub_[a-z0-9]{26}\/resume$/.test(path)
  const response = await fetch(apiOrigin + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Paddle-Version": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(updatesSubscription || resumesSubscription ? 25_000 : 10_000),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: { code?: unknown; type?: unknown } } | null
    const code = typeof error?.error?.code === "string" && /^[a-z0-9_]+$/.test(error.error.code) ? error.error.code : null
    if ((updatesSubscription || pausesSubscription) && code && error?.error?.type === "request_error" &&
        [400, 402, 403, 404, 409, 422].includes(response.status)) {
      throw new BillingMutationRejectedError(code)
    }
    throw new Error(`Paddle request failed (${response.status}${code ? ` ${code}` : ""}).`)
  }
  const result = await response.json() as { data?: T }
  if (!result.data) throw new Error("Paddle returned no data.")
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

function checkoutSnapshot(transaction: PaddleTransaction, environment: BillingProviderEnvironment): ProviderCheckoutSession {
  const metadata = stringMetadata(transaction.custom_data)
  const open = transaction.status === "draft" || transaction.status === "ready"
  return {
    id: transaction.id,
    url: open && isPaddleTransactionId(transaction.id) ? "/billing/paddle/checkout?transaction=" + transaction.id : null,
    livemode: environment === "live",
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
  return { session: checkoutSnapshot(transaction, getPaddleConfig().environment), items: transaction.items, origin: transaction.origin, status: transaction.status }
}

async function getPaddleSubscription(id: string) {
  const subscription = await paddleRequest<PaddleSubscription>(paddlePath("subscriptions", id))
  if (subscription.id !== id) throw new Error("Paddle returned another subscription.")
  return subscription
}

const scheduleFields = [
  "billing_schedule_mutation_id", "billing_schedule_mutation_kind", "billing_schedule_target_plan_key",
  "billing_schedule_target_interval", "billing_schedule_target_price_id", "billing_schedule_effective_at",
  "billing_schedule_current_price_id", "billing_schedule_current_product_id",
  "billing_schedule_strategy",
] as const

function withoutSchedule(customData: PaddleSubscription["custom_data"]) {
  const metadata = stringMetadata(customData)
  for (const key of scheduleFields) delete metadata[key]
  return metadata
}

function getDeferredIntervalChange(subscription: PaddleSubscription): ProviderSubscriptionSnapshot["deferredIntervalChange"] {
  const data = stringMetadata(subscription.custom_data)
  if (data.billing_schedule_strategy !== "pause_then_resume") return
  const { billing_schedule_mutation_id: scheduleId, billing_schedule_effective_at: effectiveAt,
    billing_schedule_current_price_id: currentPriceId, billing_schedule_target_price_id: targetPriceId,
    billing_schedule_target_plan_key: targetPlanKey } = data
  const boundary = Date.parse(effectiveAt)
  const item = subscription.items[0]
  const priceId = item?.price.id
  if (!scheduleId || !Number.isFinite(boundary) || !currentPriceId || !targetPriceId || !targetPlanKey ||
      subscription.items.length !== 1 || item.quantity !== 1 || subscription.collection_mode !== "automatic") return
  const base = { scheduleId, effectiveAt, currentPriceId, targetPriceId, targetPlanKey }
  if (subscription.status === "active" && priceId === currentPriceId &&
      subscription.scheduled_change?.action === "pause" && !subscription.scheduled_change.resume_at &&
      Date.parse(subscription.scheduled_change.effective_at) === boundary &&
      Date.parse(subscription.current_billing_period?.ends_at || "") === boundary) return { ...base, phase: "scheduled" }
  const pausedAt = Date.parse(subscription.paused_at || "")
  if (subscription.status === "paused" && !subscription.scheduled_change && !subscription.next_billed_at &&
      pausedAt >= boundary && (
        priceId === currentPriceId && Date.parse(subscription.current_billing_period?.ends_at || "") === boundary ||
        // Paddle resets the provider dates when staging a different interval, even while paused.
        priceId === targetPriceId && Date.parse(subscription.current_billing_period?.starts_at || "") >= pausedAt
      )) return { ...base, phase: "paused" }
  if ((subscription.status === "active" || subscription.status === "past_due") && priceId === targetPriceId &&
      Date.parse(subscription.current_billing_period?.starts_at || "") >= boundary) return { ...base, phase: "resumed" }
}

function getPaddleSchedule(subscription: PaddleSubscription) {
  const data = stringMetadata(subscription.custom_data)
  if (!data.billing_schedule_mutation_id || subscription.status === "canceled" || subscription.status === "paused") return null
  if (data.billing_schedule_strategy === "pause_then_resume") {
    const deferred = getDeferredIntervalChange(subscription)
    return deferred?.phase === "scheduled"
      ? { id: deferred.scheduleId, priceId: deferred.targetPriceId, currentPriceId: deferred.currentPriceId, currentProductId: subscription.items[0].price.product_id, effectiveAt: deferred.effectiveAt }
      : null
  }
  const effectiveAt = data.billing_schedule_effective_at
  const period = subscription.current_billing_period
  if (!period || !effectiveAt || !Number.isFinite(Date.parse(effectiveAt))) {
    throw new Error("Paddle schedule is missing a verified billing boundary.")
  }
  if (Date.parse(period.starts_at) >= Date.parse(effectiveAt)) return null
  const priceId = data.billing_schedule_target_price_id
  const currentPriceId = data.billing_schedule_current_price_id
  const currentProductId = data.billing_schedule_current_product_id
  if (!priceId || !currentPriceId || !currentProductId || subscription.items[0]?.price.id !== priceId ||
      Date.parse(period.ends_at) !== Date.parse(effectiveAt) ||
      (Date.parse(subscription.next_billed_at || "") !== Date.parse(effectiveAt) &&
        !(subscription.scheduled_change?.action === "cancel" && Date.parse(subscription.scheduled_change.effective_at) === Date.parse(effectiveAt)))) {
    throw new Error("Paddle schedule does not match the provider price and renewal date.")
  }
  return { id: data.billing_schedule_mutation_id, priceId, currentPriceId, currentProductId, effectiveAt }
}

export function normalizePaddleSubscription(subscription: PaddleSubscription, environment: BillingProviderEnvironment = "sandbox"): ProviderSubscriptionSnapshot {
  const item = subscription.items.length === 1 ? subscription.items[0] : null
  if (!item?.price || item.quantity !== 1) throw new Error("Unsupported Paddle subscription items.")
  const status = subscription.status
  const schedule = getPaddleSchedule(subscription)
  const deferred = getDeferredIntervalChange(subscription)
  const data = stringMetadata(subscription.custom_data)
  if (data.billing_schedule_strategy === "pause_then_resume" && !deferred && (
    status === "paused" && Date.parse(subscription.paused_at || "") < Date.parse(data.billing_schedule_effective_at) ||
    subscription.scheduled_change?.action === "pause" ||
    (status === "active" || status === "past_due") && item.price.id === data.billing_schedule_target_price_id
  )) throw new Error("Paddle interval change does not match its verified boundary.")
  const staged = deferred?.phase === "paused" && item.price.id === deferred.targetPriceId
  const cancelEffectiveAt = subscription.scheduled_change?.action === "cancel" ? subscription.scheduled_change.effective_at : null
  return {
    id: subscription.id,
    status: status === "active" || status === "trialing" || status === "past_due" || status === "paused" || status === "canceled" ? status : "unpaid",
    providerStatus: status,
    issueCode: null,
    livemode: environment === "live",
    customerId: subscription.customer_id,
    nextBilledAt: subscription.next_billed_at,
    currentBillingPeriod: !staged && subscription.current_billing_period
      ? { startsAt: subscription.current_billing_period.starts_at, endsAt: subscription.current_billing_period.ends_at }
      : null,
    cancelAtPeriodEnd: Boolean(cancelEffectiveAt),
    cancelEffectiveAt,
    hasPendingUpdate: false,
    scheduleId: schedule?.id ?? null,
    scheduledPlan: schedule ? { priceId: schedule.priceId, effectiveAt: schedule.effectiveAt } : null,
    deferredIntervalChange: deferred,
    collectionPaused: status === "paused",
    customData: data,
    items: [{ id: item.price.id, priceId: staged ? deferred.currentPriceId : schedule?.currentPriceId ?? item.price.id, productId: schedule?.currentProductId ?? item.price.product_id, quantity: item.quantity }],
  }
}

export async function retrievePaddleSubscription(id: string) {
  return normalizePaddleSubscription(await getPaddleSubscription(id), getPaddleConfig().environment)
}

function minorAmount(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null
  const amount = Number(value)
  return Number.isSafeInteger(amount) ? amount : null
}

function changeItems(priceId: string, effectiveAt?: string) {
  paddlePath("prices", priceId)
  return {
    items: [{ price_id: priceId, quantity: 1 }],
    proration_billing_mode: effectiveAt ? "do_not_bill" : "prorated_immediately",
    ...(effectiveAt ? { next_billed_at: effectiveAt } : {}),
  }
}

function assertScheduledPreview(preview: PaddlePreview, effectiveAt: string) {
  if (Date.parse(preview.next_billed_at || "") !== Date.parse(effectiveAt) ||
      Date.parse(preview.current_billing_period?.ends_at || "") !== Date.parse(effectiveAt) ||
      preview.immediate_transaction || !preview.next_transaction) {
    throw new BillingScheduleUnavailableError()
  }
}

function isAnnualToMonthly(subscription: PaddleSubscription, target: PaddlePrice | undefined) {
  const current = subscription.items[0]?.price
  return subscription.items.length === 1 && subscription.items[0].quantity === 1 &&
    current?.billing_cycle?.interval === "year" && current.billing_cycle.frequency === 1 &&
    target?.billing_cycle?.interval === "month" && target.billing_cycle.frequency === 1 &&
    target.product_id === current.product_id
}

function assertCanScheduleIntervalChange(subscription: PaddleSubscription, effectiveAt: string) {
  const boundary = Date.parse(effectiveAt)
  if (subscription.status !== "active" || subscription.collection_mode !== "automatic" ||
      subscription.scheduled_change || getPaddleSchedule(subscription) ||
      Date.parse(subscription.next_billed_at || "") !== boundary ||
      Date.parse(subscription.current_billing_period?.ends_at || "") !== boundary ||
      boundary - Date.now() <= 30 * 60 * 1000) throw new BillingScheduleUnavailableError()
}

async function assertSamePlanIntervalChange(current: PaddleSubscription, targetPriceId: string) {
  const { environment } = getPaddleConfig()
  const [annual, monthly] = await Promise.all([
    getProviderPriceByProviderId(provider, current.items[0].price.id, environment, false),
    getProviderPriceByProviderId(provider, targetPriceId, environment),
  ])
  if (!annual || !monthly || annual.plan_key !== monthly.plan_key || annual.currency !== monthly.currency ||
      annual.billing_interval !== "year" || monthly.billing_interval !== "month") throw new BillingScheduleUnavailableError()
}

export async function readPaddleIntervalApproval(workspaceId: string, scheduleId: string, planKey: string, effectiveAt: string) {
  const { environment } = getPaddleConfig()
  const { data, error } = await createServiceRoleClient().from("billing_mutation_transitions")
    .select("state,from_plan_key,to_plan_key,effective_at")
    .eq("workspace_id", workspaceId).eq("mutation_id", scheduleId)
    .eq("provider", provider).eq("environment", environment).eq("kind", "interval_change").maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.from_plan_key !== planKey || data.to_plan_key !== planKey ||
      Date.parse(data.effective_at || "") !== Date.parse(effectiveAt) || data.state === "failed") {
    throw new Error("Paddle interval change has no matching owner approval.")
  }
  return data.state
}

type DeferredPaddleBinding = {
  workspaceId: string
  subscriptionId: string
  customerId: string
  scheduleId: string
  effectiveAt: string
  targetPriceId: string
}

function assertPausedPaddleBinding(subscription: PaddleSubscription, binding: DeferredPaddleBinding) {
  const { environment } = getPaddleConfig()
  const change = getDeferredIntervalChange(subscription)
  const data = subscription.custom_data
  if (change?.phase !== "paused" || change.scheduleId !== binding.scheduleId || change.targetPriceId !== binding.targetPriceId ||
      Date.parse(change.effectiveAt) !== Date.parse(binding.effectiveAt) || Date.parse(change.effectiveAt) > Date.now() ||
      subscription.customer_id !== binding.customerId || data?.workspace_id !== binding.workspaceId ||
      data.billing_provider !== provider || data.billing_environment !== environment) {
    throw new Error("Paddle has not confirmed the authorized interval change at its paid boundary.")
  }
}

export async function stagePaddleDeferredInterval(binding: DeferredPaddleBinding) {
  const current = await getPaddleSubscription(binding.subscriptionId)
  assertPausedPaddleBinding(current, binding)
  if (current.items[0].price.id === binding.targetPriceId) return
  const target = await paddleRequest<PaddlePrice>(paddlePath("prices", binding.targetPriceId))
  if (target.id !== binding.targetPriceId || target.status !== "active" || !isAnnualToMonthly(current, target)) {
    throw new Error("Paddle monthly price is no longer eligible.")
  }
  const updated = await paddleRequest<PaddleSubscription>(paddlePath("subscriptions", current.id), {
    items: [{ price_id: binding.targetPriceId, quantity: 1 }],
    proration_billing_mode: "do_not_bill",
  }, "PATCH")
  assertPausedPaddleBinding(updated, binding)
  if (updated.id !== current.id || updated.items[0].price.id !== binding.targetPriceId) throw new Error("Paddle did not stage the monthly price.")
}

export async function resumePaddleDeferredInterval(binding: DeferredPaddleBinding, claimResume: () => Promise<boolean>) {
  const current = await getPaddleSubscription(binding.subscriptionId)
  assertPausedPaddleBinding(current, binding)
  if (current.items[0].price.id !== binding.targetPriceId) throw new Error("Paddle monthly price is not staged.")
  if (!await claimResume()) return false
  await paddleRequest<PaddleSubscription>(paddlePath("subscriptions", current.id) + "/resume", {
    effective_from: "immediately", on_resume: "start_new_billing_period",
  }, "POST")
  return true
}

function invoiceSummary(transaction: PaddleTransaction): ProviderInvoiceSummary {
  const total = transaction.details?.totals
  const amount = minorAmount(total?.grand_total ?? total?.total)
  if (amount === null) throw new Error("Paddle invoice is missing its amount.")
  return {
    id: transaction.id, number: transaction.invoice_number, status: "paid", currency: transaction.currency_code,
    amountDue: amount, amountPaid: amount, createdAt: transaction.billed_at || transaction.created_at,
    hostedInvoiceUrl: null, pdfUrl: null, customerId: transaction.customer_id, subscriptionId: transaction.subscription_id,
  }
}

function customerPath(id: string) {
  if (!/^ctm_[a-z0-9]{26}$/.test(id)) throw new Error("Invalid Paddle customer.")
  return "/customers/" + id
}

function transactionList(params: Record<string, string>) {
  return paddleRequest<PaddleTransaction[]>("/transactions?" + new URLSearchParams({ per_page: "20", ...params }))
}

export function matchesPaidPaddleRenewal(transaction: Pick<PaddleTransaction, "origin" | "status" | "customer_id" | "subscription_id" | "billing_period" | "items">, subscription: ProviderSubscriptionSnapshot) {
  const period = subscription.currentBillingPeriod
  const item = subscription.items[0]
  return Boolean(period && item && transaction.status === "completed" && transaction.origin === "subscription_recurring" &&
    transaction.subscription_id === subscription.id && transaction.customer_id === subscription.customerId &&
    Date.parse(transaction.billing_period?.starts_at || "") === Date.parse(period.startsAt) &&
    Date.parse(transaction.billing_period?.ends_at || "") === Date.parse(period.endsAt) &&
    transaction.items.some(row => row.price.id === item.priceId && row.quantity === item.quantity))
}

export function verifyPaddleWebhook(rawBody: string, signature: string, secret: string, now = Date.now()) {
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

export function createPaddleAdapter(): BillingProviderAdapter {
  const config = getPaddleConfig()
  const { environment } = config
  return {
    provider,
    environment,
    async createCheckoutSession(request) {
      if (!canStartPaddleCheckout(request.workspaceId)) throw new BillingConfigurationError("Checkout is temporarily unavailable.", "BILLING_DEFERRED")
      const transaction = await paddleRequest<PaddleTransaction>("/transactions", {
        items: [{ price_id: request.priceId, quantity: 1 }],
        collection_mode: "automatic",
        ...(config.siteOrigin.startsWith("https:") && { checkout: { url: config.siteOrigin + checkoutPath } }),
        custom_data: {
          workspace_id: request.workspaceId,
          billing_mutation_id: request.mutationId,
          billing_checkout_mutation_id: request.mutationId,
          billing_provider: provider,
          billing_environment: environment,
          plan_key: request.planKey,
          billing_interval: request.interval,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
        },
      }, "POST")
      return checkoutSnapshot(transaction, environment)
    },
    async retrieveCheckoutSession(id) {
      return (await retrievePaddleTransaction(id)).session
    },
    async expireCheckoutSession(id) {
      assertBillingMutationsEnabled()
      const { session } = await retrievePaddleTransaction(id)
      if (session.status !== "open" || session.paymentStatus !== "unpaid" || session.subscriptionId) return session
      const transaction = await paddleRequest<PaddleTransaction>(paddlePath("transactions", id), { status: "canceled" }, "PATCH")
      return checkoutSnapshot(transaction, environment)
    },
    retrieveSubscription: retrievePaddleSubscription,
    async retrievePrice(id) {
      const price = await paddleRequest<PaddlePrice>(paddlePath("prices", id))
      if (price.id !== id || price.status !== "active") throw new Error("Paddle price is unavailable.")
      return {
        id: price.id, productId: price.product_id, amount: Number(price.unit_price.amount), currency: price.unit_price.currency_code,
        interval: price.billing_cycle?.interval ?? null, intervalCount: price.billing_cycle?.frequency ?? null, livemode: environment === "live",
      }
    },
    async verifyWebhook(rawBody, signature) {
      return verifyPaddleWebhook(rawBody, signature, config.webhookSecret)
    },
    async getCustomerPaymentMethod() { return null },
    async listInvoices(customerId, subscriptionId) {
      customerPath(customerId)
      if (subscriptionId) paddlePath("subscriptions", subscriptionId)
      const transactions = await transactionList({
        customer_id: customerId, status: "completed", ...(subscriptionId ? { subscription_id: subscriptionId } : {}),
      })
      return transactions.filter(transaction => transaction.status === "completed" && transaction.invoice_number && transaction.customer_id === customerId &&
        (!subscriptionId || transaction.subscription_id === subscriptionId)).map(invoiceSummary)
    },
    async retrieveInvoice(id, expectedCustomerId, expectedSubscriptionId) {
      const path = paddlePath("transactions", id)
      const transaction = await paddleRequest<PaddleTransaction>(path)
      if (transaction.id !== id || transaction.status !== "completed" || transaction.customer_id !== expectedCustomerId ||
          (expectedSubscriptionId && transaction.subscription_id !== expectedSubscriptionId)) {
        throw new Error("Paddle invoice does not belong to this subscription.")
      }
      const { url } = await paddleRequest<{ url: string }>(path + "/invoice")
      if (new URL(url).protocol !== "https:") throw new Error("Invalid Paddle invoice URL.")
      return { ...invoiceSummary(transaction), pdfUrl: url }
    },
    async createPortalSession({ customerId, subscriptionId }) {
      const customer = customerPath(customerId)
      if (!subscriptionId || (await getPaddleSubscription(subscriptionId)).customer_id !== customerId) {
        throw new Error("Paddle customer does not match this subscription.")
      }
      if (environment === "live") {
        // The shared seller's authenticated portal session covers all purchases for the buyer.
        return { url: "https://buyer-portal.paddle.com" + paddlePath("subscriptions", subscriptionId) + "/view-subscription" }
      }
      const session = await paddleRequest<{ customer_id: string; urls: { general: { overview: string } } }>(
        customer + "/portal-sessions", { subscription_ids: [subscriptionId] }, "POST",
      )
      const url = new URL(session.urls.general.overview)
      if (session.customer_id !== customerId || url.protocol !== "https:" ||
          !["sandbox-customer-portal.paddle.com", "customer-portal.paddle.com"].includes(url.hostname) ||
          url.username || url.password || url.port) throw new Error("Invalid Paddle customer portal session.")
      return { url: url.href }
    },
    async previewSubscriptionChange({ subscriptionId, customerId, priceId, effectiveAt }) {
      const preview = await paddleRequest<PaddlePreview>(paddlePath("subscriptions", subscriptionId) + "/preview", changeItems(priceId, effectiveAt), "PATCH")
      if (preview.customer_id !== customerId) throw new Error("Paddle preview belongs to another customer.")
      if (effectiveAt) {
        const current = await getPaddleSubscription(subscriptionId)
        if (getDeferredIntervalChange(current)?.phase === "scheduled") throw new BillingScheduleUnavailableError()
        if (isAnnualToMonthly(current, preview.items[0]?.price)) {
          assertCanScheduleIntervalChange(current, effectiveAt)
          await assertSamePlanIntervalChange(current, priceId)
          if (current.customer_id !== customerId || preview.items[0].price.id !== priceId || preview.immediate_transaction) {
            throw new BillingScheduleUnavailableError()
          }
        } else {
          assertScheduledPreview(preview, effectiveAt)
        }
      }
      const immediate = preview.immediate_transaction?.details.totals
      const recurring = (effectiveAt ? preview.next_transaction?.details.totals : preview.recurring_transaction_details?.totals)
      const result = preview.update_summary?.result
      const creditToBalance = minorAmount(immediate?.credit_to_balance) ?? 0
      const charge = effectiveAt ? 0 : minorAmount(immediate?.balance ?? immediate?.grand_total ?? immediate?.total) ?? 0
      const credit = effectiveAt ? 0 : result?.action === "credit" ? (minorAmount(result.amount) ?? creditToBalance) : creditToBalance
      const recurringAmount = minorAmount(recurring?.grand_total ?? recurring?.total)
      if (recurringAmount === null) throw new Error("Paddle did not return a recurring charge preview.")
      return {
        amount: charge || credit, amountDue: charge, creditToBalance,
        action: charge > 0 ? "charge" : credit > 0 ? "credit" : "none",
        currency: immediate?.currency_code || preview.currency_code,
        nextPaymentAttempt: effectiveAt || preview.next_billed_at,
        recurringAmount, recurringCurrency: recurring?.currency_code || preview.currency_code,
      }
    },
    async updateSubscriptionPrice({ subscriptionId, itemId, priceId, metadata }) {
      assertBillingMutationsEnabled()
      const current = await getPaddleSubscription(subscriptionId)
      const path = paddlePath("subscriptions", subscriptionId)
      if (current.items.length !== 1 || current.items[0]?.price.id !== itemId || getPaddleSchedule(current)) {
        throw new Error("Paddle subscription changed since it was previewed.")
      }
      const updated = await paddleRequest<PaddleSubscription>(path, {
        ...changeItems(priceId), custom_data: { ...withoutSchedule(current.custom_data), ...metadata },
        on_payment_failure: "prevent_change",
      }, "PATCH")
      return normalizePaddleSubscription(updated, environment)
    },
    async schedulePlanChange(input) {
      assertBillingMutationsEnabled()
      const current = await getPaddleSubscription(input.subscriptionId)
      if (getDeferredIntervalChange(current)?.phase === "scheduled") throw new BillingScheduleUnavailableError()
      const schedule = getPaddleSchedule(current)
      const item = current.items[0]
      const currentPriceId = schedule?.currentPriceId ?? item?.price.id
      const currentProductId = schedule?.currentProductId ?? item?.price.product_id
      const effectiveAt = current.current_billing_period?.ends_at
      if (!currentPriceId || !currentProductId || currentPriceId !== input.currentPriceId || !effectiveAt ||
          Math.floor(Date.parse(effectiveAt) / 1000) !== input.periodEnd) throw new Error("Paddle's paid period changed since it was previewed.")
      const path = paddlePath("subscriptions", input.subscriptionId)
      const body = changeItems(input.targetPriceId, effectiveAt)
      const preview = await paddleRequest<PaddlePreview>(path + "/preview", body, "PATCH")
      const metadata = {
        ...withoutSchedule(current.custom_data),
        billing_schedule_mutation_id: input.mutationId,
        billing_schedule_mutation_kind: "scheduled_plan_change",
        billing_schedule_target_plan_key: input.targetPlanKey,
        billing_schedule_target_interval: input.targetInterval,
        billing_schedule_target_price_id: input.targetPriceId,
        billing_schedule_current_price_id: currentPriceId,
        billing_schedule_current_product_id: currentProductId,
        billing_schedule_effective_at: effectiveAt,
      }
      let updated: PaddleSubscription
      if (isAnnualToMonthly(current, preview.items[0]?.price)) {
        assertCanScheduleIntervalChange(current, effectiveAt)
        await assertSamePlanIntervalChange(current, input.targetPriceId)
        if (preview.immediate_transaction || preview.items[0].price.id !== input.targetPriceId || input.targetInterval !== "month") {
          throw new BillingScheduleUnavailableError()
        }
        const workspaceId = stringMetadata(current.custom_data).workspace_id
        if (!workspaceId) throw new BillingScheduleUnavailableError()
        await readPaddleIntervalApproval(workspaceId, input.mutationId, input.targetPlanKey, effectiveAt)
        const marked = await paddleRequest<PaddleSubscription>(path, {
          custom_data: { ...metadata, billing_schedule_strategy: "pause_then_resume" },
        }, "PATCH")
        assertCanScheduleIntervalChange(marked, effectiveAt)
        updated = await paddleRequest<PaddleSubscription>(path + "/pause", { effective_from: "next_billing_period" }, "POST")
      } else {
        assertScheduledPreview(preview, effectiveAt)
        updated = await paddleRequest<PaddleSubscription>(path, { ...body, custom_data: metadata }, "PATCH")
      }
      if (getPaddleSchedule(updated)?.id !== input.mutationId) throw new Error("Paddle did not confirm the scheduled price.")
      return { scheduleId: input.mutationId, effectiveAt }
    },
    async releaseSchedule(subscriptionId, scheduleId, mutationId, mutationKind = "undo_plan_change") {
      assertBillingMutationsEnabled()
      const current = await getPaddleSubscription(subscriptionId)
      const schedule = getPaddleSchedule(current)
      if (!schedule || schedule.id !== scheduleId) throw new Error("Paddle schedule changed before it could be undone.")
      const path = paddlePath("subscriptions", subscriptionId)
      const metadata = {
        ...withoutSchedule(current.custom_data),
        ...(mutationKind === "undo_plan_change" ? {
          billing_mutation_id: mutationId, billing_mutation_kind: mutationKind, plan_key: "", billing_interval: "",
        } : {}),
      }
      if (getDeferredIntervalChange(current)?.phase === "scheduled") {
        const cleared = await paddleRequest<PaddleSubscription>(path, { scheduled_change: null }, "PATCH")
        if (cleared.status !== "active" || cleared.scheduled_change || cleared.items[0]?.price.id !== schedule.currentPriceId ||
            Date.parse(cleared.next_billed_at || "") !== Date.parse(schedule.effectiveAt)) throw new Error("Paddle did not restore the annual renewal.")
        await paddleRequest<PaddleSubscription>(path, { custom_data: metadata }, "PATCH")
        return
      }
      const body = changeItems(schedule.currentPriceId, schedule.effectiveAt)
      assertScheduledPreview(await paddleRequest<PaddlePreview>(path + "/preview", body, "PATCH"), schedule.effectiveAt)
      const updated = await paddleRequest<PaddleSubscription>(path, { ...body, custom_data: metadata }, "PATCH")
      if (updated.items[0]?.price.id !== schedule.currentPriceId || getPaddleSchedule(updated)) throw new Error("Paddle did not undo the scheduled price.")
    },
    async scheduleCancellation(subscriptionId) {
      assertBillingMutationsEnabled()
      const path = paddlePath("subscriptions", subscriptionId)
      return normalizePaddleSubscription(await paddleRequest<PaddleSubscription>(path + "/cancel", { effective_from: "next_billing_period" }, "POST"), environment)
    },
    async undoScheduledCancellation(subscriptionId) {
      assertBillingMutationsEnabled()
      // Paddle requires scheduled_change to be cleared in its own request.
      const updated = await paddleRequest<PaddleSubscription>(
        paddlePath("subscriptions", subscriptionId), { scheduled_change: null }, "PATCH",
      )
      return normalizePaddleSubscription(updated, environment)
    },
    async hasPaidRenewal(subscription) {
      paddlePath("subscriptions", subscription.id)
      const transactions = await transactionList({ subscription_id: subscription.id, origin: "subscription_recurring", status: "completed" })
      return transactions.some(transaction => matchesPaidPaddleRenewal(transaction, subscription))
    },
  }
}
