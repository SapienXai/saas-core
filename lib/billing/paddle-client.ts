import "server-only"

import { Environment, Paddle } from "@paddle/paddle-node-sdk"

export type BillingEnvironment = "sandbox" | "live"

export class BillingConfigurationError extends Error {
  readonly code: "BILLING_NOT_CONFIGURED" | "BILLING_DEFERRED"

  constructor(message = "Paddle billing is not configured for this environment.", code: BillingConfigurationError["code"] = "BILLING_NOT_CONFIGURED") {
    super(message)
    this.name = "BillingConfigurationError"
    this.code = code
  }
}

export function isBillingDeferred() {
  return process.env.SAAS_CORE_BILLING_MODE === "deferred"
}

function assertBillingEnabled() {
  if (isBillingDeferred()) {
    throw new BillingConfigurationError("Billing is deferred while the Stripe migration is pending.", "BILLING_DEFERRED")
  }
}

function readEnvironment(): BillingEnvironment | null {
  const value = process.env.PADDLE_ENVIRONMENT
  if (value === "sandbox" || value === "live") return value
  return null
}

export function getBillingEnvironment(): BillingEnvironment {
  assertBillingEnabled()
  const environment = readEnvironment()
  if (!environment) {
    throw new BillingConfigurationError("PADDLE_ENVIRONMENT must be set to sandbox or live.")
  }
  return environment
}

function environmentForSdk(environment: BillingEnvironment) {
  return environment === "sandbox" ? Environment.sandbox : Environment.production
}

export function getPaddleServerClient(idempotencyKey?: string) {
  const environment = getBillingEnvironment()
  const apiKey = process.env.PADDLE_API_KEY
  if (!apiKey) throw new BillingConfigurationError("PADDLE_API_KEY is not configured.")
  return new Paddle(apiKey, {
    environment: environmentForSdk(environment),
    ...(idempotencyKey ? { customHeaders: { "X-Transaction-ID": idempotencyKey } } : {}),
  })
}

export function verifyPaddleWebhook(rawBody: string, signature: string) {
  const environment = getBillingEnvironment()
  const secret = process.env.PADDLE_WEBHOOK_SECRET
  if (!secret) throw new BillingConfigurationError("PADDLE_WEBHOOK_SECRET is not configured.")
  // The SDK uses the API key only to configure the client object. Verification
  // itself uses the destination secret and never performs a network request.
  const verifier = new Paddle(process.env.PADDLE_API_KEY || "webhook-verifier", {
    environment: environmentForSdk(environment),
  })
  return verifier.webhooks.unmarshal(rawBody, secret, signature)
}

export function getPublicPaddleConfig() {
  if (isBillingDeferred()) return null
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
  const environment = readEnvironment()
  if (!token || !environment) return null

  const expectedPrefix = environment === "sandbox" ? "test_" : "live_"
  if (!token.startsWith(expectedPrefix)) return null

  return {
    token,
    environment: environment === "sandbox" ? ("sandbox" as const) : ("production" as const),
  }
}

export function isPaddleBillingConfigured() {
  if (isBillingDeferred()) return false
  try {
    getBillingEnvironment()
    return Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_WEBHOOK_SECRET)
  } catch {
    return false
  }
}
