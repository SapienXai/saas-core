import { afterEach, describe, expect, it, vi } from "vitest"
import { assertBillingMutationsEnabled, getBillingEnvironment, isBillingDeferred, isStripeBillingConfigured } from "../lib/billing/config"
import { canStartBillingCheckout, getBillingProviderName, isBillingProviderConfigured } from "../lib/billing/providers"
import { createStripeBillingAdapter } from "../lib/billing/providers/stripe"

afterEach(() => vi.unstubAllEnvs())

function configureSandbox() {
  vi.stubEnv("STRIPE_ENVIRONMENT", "sandbox")
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_placeholder")
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder")
  vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_1Tvn6tDKdVwvpd8n")
  vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "bpc_testunit")
}

describe("billing deployment mode", () => {
  it("defaults new checkout to Paddle, supports explicit Stripe, and rejects an unknown provider", () => {
    configureSandbox()
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "enabled")
    vi.stubEnv("SAAS_CORE_BILLING_PROVIDER", undefined)
    vi.stubEnv("PADDLE_ENVIRONMENT", undefined)
    expect(getBillingProviderName()).toBe("paddle")
    expect(canStartBillingCheckout("workspace")).toBe(false)
    vi.stubEnv("SAAS_CORE_BILLING_PROVIDER", "  ")
    expect(getBillingProviderName()).toBe("paddle")
    vi.stubEnv("SAAS_CORE_BILLING_PROVIDER", "stripe")
    expect(getBillingProviderName()).toBe("stripe")
    expect(isBillingProviderConfigured()).toBe(true)
    vi.stubEnv("SAAS_CORE_BILLING_PROVIDER", "unknown")
    expect(() => getBillingProviderName()).toThrow("Unknown billing provider")
    expect(isBillingProviderConfigured()).toBe(false)
  })

  it("blocks provider mutations while leaving signed webhook verification enabled", async () => {
    configureSandbox()
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "deferred")

    expect(isBillingDeferred()).toBe(true)
    expect(getBillingEnvironment()).toBe("sandbox")
    expect(isStripeBillingConfigured()).toBe(true)
    expect(() => assertBillingMutationsEnabled()).toThrow("Billing changes are temporarily unavailable.")
    const adapter = createStripeBillingAdapter()
    await expect(adapter.createCheckoutSession({
      mutationId: "mutation-test",
      workspaceId: "workspace-test",
      planKey: "starter",
      interval: "month",
      priceId: "price_test",
      successUrl: "https://placedj.example/manage/plan",
      cancelUrl: "https://placedj.example/manage/plan",
    })).rejects.toMatchObject({ code: "BILLING_DEFERRED" })
    await expect(adapter.verifyWebhook("{}", "t=1,v1=invalid")).rejects.toThrow(/signature/i)
  })

  it("uses a deliberately configured Stripe Sandbox when deferred mode is unset", () => {
    configureSandbox()
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "")
    expect(isBillingDeferred()).toBe(false)
    expect(getBillingEnvironment()).toBe("sandbox")
    expect(isStripeBillingConfigured()).toBe(true)
  })
})
