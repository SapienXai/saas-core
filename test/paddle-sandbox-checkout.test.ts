import { createHmac } from "node:crypto"
import { normalizePaddleSandboxEvent } from "../lib/billing/paddle-webhook"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getPaddleReturnPath, getPaddleSandboxConfig, matchesPaidPaddleRenewal, normalizePaddleSubscription, verifyPaddleSandboxWebhook } from "../lib/billing/providers/paddle"

afterEach(() => vi.unstubAllEnvs())

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

    expect(getPaddleSandboxConfig().environment).toBe("sandbox")
    vi.stubEnv("SUPABASE_URL", "https://test.supabase.co")
    expect(() => getPaddleSandboxConfig()).toThrow()
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:58521")
    vi.stubEnv("PADDLE_ENVIRONMENT", "live")
    expect(() => getPaddleSandboxConfig()).toThrow()
    vi.stubEnv("PADDLE_ENVIRONMENT", "sandbox")
    vi.stubEnv("NODE_ENV", "production")
    expect(() => getPaddleSandboxConfig()).toThrow()
  })

  it("binds the webhook signature to the raw body and recent timestamp", () => {
    const raw = '{"data":{"status":"completed"}}'
    const secret = "test-webhook-secret"
    const ts = 1_780_000_000
    const signature = `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex")}`
    expect(verifyPaddleSandboxWebhook(raw, signature, secret, ts * 1000)).toEqual({ data: { status: "completed" } })
    expect(() => verifyPaddleSandboxWebhook(raw + " ", signature, secret, ts * 1000)).toThrow()
    expect(() => verifyPaddleSandboxWebhook(raw, signature, secret, ts * 1000 + 5001)).toThrow()
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
  const current = { id: "pri_old", product_id: "pro_old" }
  const target = { id: "pri_new", product_id: "pro_new" }
  const scheduled: Parameters<typeof normalizePaddleSubscription>[0] = {
    id: "sub_test", status: "active", customer_id: "ctm_test", currency_code: "USD",
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
    expect(matchesPaidPaddleRenewal({ ...transaction, customer_id: "other" }, snapshot)).toBe(false)
    expect(matchesPaidPaddleRenewal({ ...transaction, billing_period: scheduled.current_billing_period }, snapshot)).toBe(false)
    expect(matchesPaidPaddleRenewal({ ...transaction, items: [{ price: current, quantity: 1 }] }, snapshot)).toBe(false)
  })

  it("normalizes the signed recurring transaction identity for reconciliation", () => {
    const event = normalizePaddleSandboxEvent({
      event_id: "evt_00000000000000000000000000", event_type: "transaction.completed", occurred_at: boundary,
      data: { id: "txn_test", origin: "subscription_recurring", subscription_id: renewed.id },
    })
    expect(event).toMatchObject({ objectId: "txn_test", origin: "subscription_recurring", subscriptionId: renewed.id })
  })
})
