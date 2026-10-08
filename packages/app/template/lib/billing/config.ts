import "server-only"

import type { BillingProviderEnvironment } from "./provider"

export class BillingConfigurationError extends Error {
  readonly code: "BILLING_NOT_CONFIGURED" | "BILLING_DEFERRED" | "BILLING_ACCOUNT_MISMATCH"

  constructor(
    message = "Stripe billing is not configured for this environment.",
    code: BillingConfigurationError["code"] = "BILLING_NOT_CONFIGURED",
  ) {
    super(message)
    this.name = "BillingConfigurationError"
    this.code = code
  }
}

export function isBillingDeferred() {
  return process.env.SAAS_CORE_BILLING_MODE === "deferred"
}

export function assertBillingMutationsEnabled() {
  if (isBillingDeferred()) {
    throw new BillingConfigurationError("Billing changes are temporarily unavailable.", "BILLING_DEFERRED")
  }
}

function readBillingEnvironment(): BillingProviderEnvironment | null {
  const environment = process.env.STRIPE_ENVIRONMENT
  return environment === "sandbox" || environment === "live" ? environment : null
}

export function getBillingEnvironment(): BillingProviderEnvironment {
  const environment = readBillingEnvironment()
  if (!environment) {
    throw new BillingConfigurationError("STRIPE_ENVIRONMENT must be set to sandbox or live.")
  }
  return environment
}

function keyMatchesEnvironment(key: string, environment: BillingProviderEnvironment) {
  const expected = environment === "sandbox" ? /^(sk|rk)_test_/ : /^(sk|rk)_live_/
  return expected.test(key)
}

export type StripeBillingConfig = {
  environment: BillingProviderEnvironment
  secretKey: string
  webhookSecret: string
  expectedAccountId: string
  portalConfigurationId: string | null
}

/** Read configuration without creating a network client or exposing secrets. */
export function getStripeBillingConfig(): StripeBillingConfig {
  const environment = getBillingEnvironment()
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  const expectedAccountId = process.env.STRIPE_ACCOUNT_ID?.trim()
  const portalConfigurationId = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim() || null
  if (!secretKey) throw new BillingConfigurationError("STRIPE_SECRET_KEY is not configured.")
  if (!keyMatchesEnvironment(secretKey, environment)) {
    throw new BillingConfigurationError("STRIPE_SECRET_KEY does not match STRIPE_ENVIRONMENT.")
  }
  if (!webhookSecret) throw new BillingConfigurationError("STRIPE_WEBHOOK_SECRET is not configured.")
  if (!webhookSecret.startsWith("whsec_")) throw new BillingConfigurationError("STRIPE_WEBHOOK_SECRET has an invalid format.")
  if (!expectedAccountId || !/^acct_[A-Za-z0-9]+$/.test(expectedAccountId)) {
    throw new BillingConfigurationError("STRIPE_ACCOUNT_ID must contain the expected Stripe account ID.")
  }
  if (portalConfigurationId && !/^bpc_[A-Za-z0-9]+$/.test(portalConfigurationId)) {
    throw new BillingConfigurationError("STRIPE_BILLING_PORTAL_CONFIGURATION_ID has an invalid format.")
  }
  return { environment, secretKey, webhookSecret, expectedAccountId, portalConfigurationId }
}

export function assertStripeBillingReady() {
  const config = getStripeBillingConfig()
  if (!config.portalConfigurationId) {
    throw new BillingConfigurationError("STRIPE_BILLING_PORTAL_CONFIGURATION_ID is not configured.")
  }
  return config
}

export function isStripeBillingConfigured() {
  try {
    return Boolean(assertStripeBillingReady().portalConfigurationId)
  } catch {
    return false
  }
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret) throw new BillingConfigurationError("STRIPE_WEBHOOK_SECRET is not configured.")
  return secret
}
