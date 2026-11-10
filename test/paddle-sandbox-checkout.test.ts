import { createHmac } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getPaddleReturnPath, getPaddleSandboxConfig, verifyPaddleSandboxWebhook } from "../lib/billing/providers/paddle"

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
