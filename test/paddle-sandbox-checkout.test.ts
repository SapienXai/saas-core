import { createHmac } from "node:crypto"
import { normalizePaddleEvent } from "../lib/billing/paddle-webhook"
import { afterEach, describe, expect, it, vi } from "vitest"
import { canStartPaddleCheckout, createPaddleAdapter, getPaddleReturnPath, getPaddleConfig, matchesPaidPaddleRenewal, normalizePaddleSubscription, verifyPaddleWebhook } from "../lib/billing/providers/paddle"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("Paddle Sandbox checkout", () => {
  it("requires a local development database and Sandbox credentials", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("SAAS_CORE_BILLING_PROVIDER", "paddle")
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "enabled")
    vi.stubEnv("PADDLE_ENVIRONMENT", "sandbox")
    vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_fixture")
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "test-webhook-secret")
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_fixture")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3187")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:58521")
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:58521")

    expect(getPaddleConfig().environment).toBe("sandbox")
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "deferred")
    expect(canStartPaddleCheckout("workspace")).toBe(false)
    expect(getPaddleConfig().environment).toBe("sandbox")
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "enabled")
    vi.stubEnv("SAAS_CORE_BILLING_PROVIDER", "stripe")
    expect(canStartPaddleCheckout("workspace")).toBe(false)
    expect(getPaddleConfig().environment).toBe("sandbox")
    vi.stubEnv("SAAS_CORE_BILLING_PROVIDER", "paddle")
    vi.stubEnv("SUPABASE_URL", "https://test.supabase.co")
    expect(() => getPaddleConfig()).toThrow()
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:58521")
    vi.stubEnv("PADDLE_ENVIRONMENT", "live")
    expect(() => getPaddleConfig()).toThrow()
    vi.stubEnv("PADDLE_ENVIRONMENT", "sandbox")
    vi.stubEnv("NODE_ENV", "production")
    expect(() => getPaddleConfig()).toThrow()
  })

  it("allows explicitly bound hosted Sandbox while rejecting mixed credentials and database origins", () => {
    const env = {
      NODE_ENV: "production", VERCEL_ENV: "production", SAAS_CORE_BILLING_PROVIDER: "paddle",
      SAAS_CORE_BILLING_MODE: "enabled", PADDLE_ENVIRONMENT: "sandbox",
      PADDLE_APP_ORIGIN: "https://app.example.com", APP_URL: "https://app.example.com",
      NEXT_PUBLIC_SITE_URL: "https://example.com",
      SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      PADDLE_API_KEY: "pdl_sdbx_fixture", NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_fixture",
      PADDLE_WEBHOOK_SECRET: "fixture-webhook-secret",
    }
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    expect(getPaddleConfig()).toMatchObject({ environment: "sandbox", siteOrigin: env.APP_URL, apiOrigin: "https://sandbox-api.paddle.com" })
    expect(canStartPaddleCheckout("workspace")).toBe(true)
    for (const [name, value] of Object.entries({
      PADDLE_API_KEY: "pdl_live_fixture", NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_fixture",
      PADDLE_APP_ORIGIN: "https://other.example.com", NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
      VERCEL_ENV: "preview",
    })) {
      vi.stubEnv(name, value)
      expect(() => getPaddleConfig()).toThrow()
      vi.stubEnv(name, env[name as keyof typeof env])
    }
  })

  it("requires verified buyer email before returning a hosted Sandbox portal token", async () => {
    const env = {
      NODE_ENV: "production", VERCEL_ENV: "production", SAAS_CORE_BILLING_PROVIDER: "paddle",
      SAAS_CORE_BILLING_MODE: "enabled", PADDLE_ENVIRONMENT: "sandbox",
      PADDLE_APP_ORIGIN: "https://app.example.com", APP_URL: "https://app.example.com",
      SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      PADDLE_API_KEY: "pdl_sdbx_fixture", NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_fixture",
      PADDLE_WEBHOOK_SECRET: "fixture-webhook-secret",
    }
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    const subscriptionId = `sub_${"a".repeat(26)}`
    const customerId = `ctm_${"b".repeat(26)}`
    const portal = `https://sandbox-customer-portal.paddle.com/cpl_${"c".repeat(26)}?action=view_subscription&subscription_id=${subscriptionId}`
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ data: url.endsWith(customerId)
      ? { id: customerId, email: "buyer@example.com" }
      : { id: subscriptionId, customer_id: customerId, management_urls: { view_subscription: portal + "&token=fixture" } },
    })))
    const adapter = createPaddleAdapter()
    const input = { customerId, subscriptionId, returnUrl: env.APP_URL }
    await expect(adapter.createPortalSession({ ...input, customerId: "ctm_" + "d".repeat(26) })).rejects.toThrow("customer does not match")
    await expect(adapter.createPortalSession(input)).resolves.toEqual({ url: portal })
    await expect(adapter.createPortalSession({ ...input, confirmedBuyerEmail: "owner@example.com" })).resolves.toEqual({ url: portal })
    await expect(adapter.createPortalSession({ ...input, confirmedBuyerEmail: "BUYER@example.com" })).resolves.toEqual({ url: portal + "&token=fixture" })
  })

  it("binds the webhook signature to the raw body and recent timestamp", () => {
    const raw = '{"data":{"status":"completed"}}'
    const secret = "test-webhook-secret"
    const ts = 1_780_000_000
    const signature = `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex")}`
    expect(verifyPaddleWebhook(raw, signature, secret, ts * 1000)).toEqual({ data: { status: "completed" } })
    expect(() => verifyPaddleWebhook(raw + " ", signature, secret, ts * 1000)).toThrow()
    expect(() => verifyPaddleWebhook(raw, signature, secret, ts * 1000 + 5001)).toThrow()
  })

  it("keeps the return local and replaces any supplied checkout identifier", () => {
    const origin = "http://localhost:3187"
    expect(getPaddleReturnPath(origin + "/player/mode?checkout_session_id=old&plan=pro-v3", origin, "txn_new", true))
      .toBe("/player/mode?plan=pro-v3&checkout_session_id=txn_new")
    expect(getPaddleReturnPath("https://other.example/", origin, "txn_new", false))
      .toBe("/manage/plan?checkout=cancelled")
    expect(getPaddleReturnPath(origin + "//other.example/", origin, "txn_new", false))
      .toBe("/manage/plan?checkout=cancelled")
  })
})

describe("Paddle Sandbox renewal boundary", () => {
  const start = "2026-11-10T19:00:00.000Z"
  const boundary = "2026-12-10T19:00:00.000Z"
  const end = "2027-01-10T19:00:00.000Z"
  const current = { id: "pri_old", product_id: "pro_old", status: "active", unit_price: { amount: "49000", currency_code: "USD" }, billing_cycle: { interval: "year", frequency: 1 } }
  const target = { id: "pri_new", product_id: "pro_new", status: "active", unit_price: { amount: "4900", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } }
  const scheduled: Parameters<typeof normalizePaddleSubscription>[0] = {
    id: "sub_test", status: "active", customer_id: "ctm_test", currency_code: "USD",
    collection_mode: "automatic", paused_at: null,
    current_billing_period: { starts_at: start, ends_at: boundary }, next_billed_at: boundary, scheduled_change: null,
    items: [{ price: target, quantity: 1 }],
    custom_data: {
      billing_schedule_mutation_id: "test-mutation",
      billing_schedule_target_price_id: target.id,
      billing_schedule_current_price_id: current.id,
      billing_schedule_current_product_id: current.product_id,
      billing_schedule_effective_at: boundary,
    },
  }
  const renewed = { ...scheduled, current_billing_period: { starts_at: boundary, ends_at: end }, next_billed_at: end }

  it("retains the previous price while Paddle is still in the paid period", () => {
    const snapshot = normalizePaddleSubscription(scheduled)
    expect(snapshot.items[0]).toMatchObject({ priceId: current.id, productId: current.product_id })
    expect(snapshot.scheduledPlan).toEqual({ priceId: target.id, effectiveAt: boundary })
    expect(() => normalizePaddleSubscription({ ...scheduled, next_billed_at: end })).toThrow("renewal date")
  })

  it("requires a completed recurring payment for the same new period, customer, and price", () => {
    const snapshot = normalizePaddleSubscription(renewed)
    expect(snapshot.scheduledPlan).toBeNull()
    expect(snapshot.items[0]?.priceId).toBe(target.id)
    const transaction = {
      origin: "subscription_recurring", status: "completed", subscription_id: renewed.id, customer_id: renewed.customer_id,
      billing_period: renewed.current_billing_period, items: renewed.items,
    }
    expect(matchesPaidPaddleRenewal(transaction, snapshot)).toBe(true)
    expect(matchesPaidPaddleRenewal({ ...transaction, status: "billed" }, snapshot)).toBe(false)
    expect(matchesPaidPaddleRenewal({ ...transaction, origin: "subscription_update" }, snapshot)).toBe(false)
    const approvedChange = { ...snapshot, customData: { billing_mutation_id: "approved", billing_mutation_kind: "plan_change" } }
    const changePayment = { ...transaction, origin: "subscription_update", custom_data: { billing_mutation_id: "approved" } }
    expect(matchesPaidPaddleRenewal(changePayment, approvedChange)).toBe(true)
    expect(matchesPaidPaddleRenewal(changePayment, { ...approvedChange, customData: { ...approvedChange.customData, billing_mutation_id: "different" } })).toBe(false)
    expect(matchesPaidPaddleRenewal({ ...transaction, customer_id: "other" }, snapshot)).toBe(false)
    expect(matchesPaidPaddleRenewal({ ...transaction, billing_period: scheduled.current_billing_period }, snapshot)).toBe(false)
    expect(matchesPaidPaddleRenewal({ ...transaction, items: [{ price: current, quantity: 1 }] }, snapshot)).toBe(false)
  })

  it("normalizes the signed recurring transaction identity for reconciliation", () => {
    const event = normalizePaddleEvent({
      event_id: "evt_00000000000000000000000000", event_type: "transaction.completed", occurred_at: boundary,
      data: { id: "txn_test", origin: "subscription_recurring", subscription_id: renewed.id },
    })
    expect(event).toMatchObject({ objectId: "txn_test", origin: "subscription_recurring", subscriptionId: renewed.id })
  })

  it("keeps the annual price for a native pause at the exact paid boundary", () => {
    const annual = {
      ...scheduled, next_billed_at: null, items: [{ price: current, quantity: 1 }],
      scheduled_change: { action: "pause", effective_at: boundary, resume_at: null },
      custom_data: { ...scheduled.custom_data, billing_schedule_strategy: "pause_then_resume", billing_schedule_target_plan_key: "pro" },
    }
    const snapshot = normalizePaddleSubscription(annual)
    expect(snapshot.items[0]?.priceId).toBe(current.id)
    expect(snapshot.scheduledPlan).toEqual({ priceId: target.id, effectiveAt: boundary })
    expect(snapshot.deferredIntervalChange).toMatchObject({ phase: "scheduled", effectiveAt: boundary })
    expect(normalizePaddleSubscription({ ...annual, scheduled_change: null }).deferredIntervalChange).toBeUndefined()
    expect(() => normalizePaddleSubscription({ ...annual, scheduled_change: { action: "pause", effective_at: start } })).toThrow("boundary")
  })

  it("permits staging only after the approved pause and recognizes the resumed monthly period", () => {
    const paused = {
      ...scheduled, status: "paused", paused_at: boundary, next_billed_at: null,
      items: [{ price: current, quantity: 1 }],
      custom_data: { ...scheduled.custom_data, billing_schedule_strategy: "pause_then_resume", billing_schedule_target_plan_key: "pro" },
    }
    expect(normalizePaddleSubscription(paused).deferredIntervalChange).toMatchObject({ phase: "paused", effectiveAt: boundary })
    expect(() => normalizePaddleSubscription({ ...paused, paused_at: start })).toThrow("boundary")
    const staged = { ...paused, items: [{ price: target, quantity: 1 }], current_billing_period: { starts_at: boundary, ends_at: end } }
    expect(normalizePaddleSubscription(staged)).toMatchObject({
      deferredIntervalChange: { phase: "paused", effectiveAt: boundary },
      currentBillingPeriod: null,
      items: [{ priceId: current.id }],
    })
    const unrelatedLaterPause = { ...staged, paused_at: end }
    expect(normalizePaddleSubscription(unrelatedLaterPause).deferredIntervalChange).toBeUndefined()
    const resumed = { ...renewed, custom_data: paused.custom_data }
    expect(normalizePaddleSubscription(resumed).deferredIntervalChange).toMatchObject({ phase: "resumed", effectiveAt: boundary })
    expect(() => normalizePaddleSubscription({ ...resumed, current_billing_period: scheduled.current_billing_period })).toThrow("boundary")
  })
})


describe("Paddle Live checkout configuration", () => {
  const account = "slr_" + "0".repeat(26)

  function configureLive() {
    const env = {
      NODE_ENV: "production", VERCEL_ENV: "production", SAAS_CORE_BILLING_PROVIDER: "paddle",
      SAAS_CORE_BILLING_MODE: "enabled", PADDLE_ENVIRONMENT: "live", PADDLE_ACCOUNT_ID: account,
      PADDLE_APP_ORIGIN: "https://app.example.com", APP_URL: "https://app.example.com",
      SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      PADDLE_API_KEY: "pdl_live_fixture", NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_fixture",
      PADDLE_WEBHOOK_SECRET: "fixture-webhook-secret", PADDLE_LIVE_CHECKOUT_MODE: "disabled",
    }
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  }

  it("allows the pilot Workspace and keeps the adapter configured when checkout is closed", () => {
    configureLive()
    expect(getPaddleConfig()).toMatchObject({ environment: "live", apiOrigin: "https://api.paddle.com" })
    expect(canStartPaddleCheckout("workspace")).toBe(false)
    vi.stubEnv("PADDLE_LIVE_CHECKOUT_MODE", "pilot")
    vi.stubEnv("PADDLE_LIVE_CHECKOUT_WORKSPACE_ID", "workspace")
    expect(canStartPaddleCheckout("workspace")).toBe(true)
    expect(canStartPaddleCheckout("another-workspace")).toBe(false)
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "deferred")
    expect(canStartPaddleCheckout("workspace")).toBe(false)
    expect(getPaddleConfig().environment).toBe("live")
    vi.stubEnv("VERCEL_ENV", "preview")
    expect(() => getPaddleConfig()).toThrow()
  })

  it("checks the API key account before retrieving a Live price", async () => {
    configureLive()
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      data: { api: { environment: "production" }, caller: { auth_type: "api_key", account: { id: "another-account" } } },
    }))
    vi.stubGlobal("fetch", fetchMock)
    await expect(createPaddleAdapter().retrievePrice("pri_" + "0".repeat(26))).rejects.toThrow("another account")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.paddle.com/")
  })
})
