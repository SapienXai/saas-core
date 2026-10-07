import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getBillingEnvironment,
  getPaddleServerClient,
  getPublicPaddleConfig,
  isBillingDeferred,
  isPaddleBillingConfigured,
  verifyPaddleWebhook,
} from "../lib/billing/paddle-client"

afterEach(() => vi.unstubAllEnvs())

describe("billing deployment mode", () => {
  it("blocks all Paddle configuration and requests when billing is deferred", () => {
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "deferred")
    vi.stubEnv("PADDLE_ENVIRONMENT", "live")
    vi.stubEnv("PADDLE_API_KEY", "pdl_live_server_secret")
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "pdl_live_webhook_secret")
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "live_client_token")

    expect(isBillingDeferred()).toBe(true)
    expect(isPaddleBillingConfigured()).toBe(false)
    expect(getPublicPaddleConfig()).toBeNull()
    expect(() => getBillingEnvironment()).toThrow("Billing is deferred while the Stripe migration is pending.")
    expect(() => getPaddleServerClient()).toThrow("Billing is deferred while the Stripe migration is pending.")
    expect(() => verifyPaddleWebhook("{}", "signature")).toThrow("Billing is deferred while the Stripe migration is pending.")
  })

  it("preserves deliberate local Paddle Sandbox configuration when deferred mode is unset", () => {
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "")
    vi.stubEnv("PADDLE_ENVIRONMENT", "sandbox")
    vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_server_key")
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "pdl_sdbx_webhook_secret")
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_client_token")

    expect(isBillingDeferred()).toBe(false)
    expect(getBillingEnvironment()).toBe("sandbox")
    expect(isPaddleBillingConfigured()).toBe(true)
    expect(getPublicPaddleConfig()).toMatchObject({ environment: "sandbox", token: "test_client_token" })
  })
})
