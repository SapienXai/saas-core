import "server-only"

import type { BillingProviderEnvironment, BillingProviderAdapter } from "../provider"
import { getSelectedCheckoutProvider } from "../checkout-provider.mjs"
import { BillingConfigurationError, assertBillingMutationsEnabled, getBillingEnvironment, isStripeBillingConfigured, isBillingDeferred } from "../config"
import { canStartPaddleCheckout, createPaddleAdapter, getPaddleConfig, isPaddleBillingConfigured } from "./paddle"
import { createStripeBillingAdapter } from "./stripe"

type SupportedBillingProvider = "stripe" | "paddle"

export type BillingProviderBinding = {
  provider: SupportedBillingProvider
  environment: BillingProviderEnvironment
}

/** Resolve the deployment's choice for new checkout. */
export function getBillingProviderName(): SupportedBillingProvider {
  const provider = getSelectedCheckoutProvider()
  if (!provider) throw new BillingConfigurationError("Unknown billing provider.")
  return provider
}

export function getBillingProviderEnvironment(provider = getBillingProviderName()) {
  return provider === "paddle" ? getPaddleConfig().environment : getBillingEnvironment()
}

export function isBillingProviderConfigured(provider?: SupportedBillingProvider) {
  try {
    return (provider ?? getBillingProviderName()) === "paddle" ? isPaddleBillingConfigured() : isStripeBillingConfigured()
  } catch {
    return false
  }
}

export function getBillingProviderAdapter(provider = getBillingProviderName()): BillingProviderAdapter {
  return provider === "paddle" ? createPaddleAdapter() : createStripeBillingAdapter()
}

/** Validate persisted routing before using the credentials for that provider. */
export function requireBillingProviderBinding(provider: string | null, environment: string | null): BillingProviderBinding {
  if (provider !== "stripe" && provider !== "paddle") {
    throw new BillingConfigurationError("No supported billing provider is linked to this record.")
  }
  if ((environment !== "sandbox" && environment !== "live") || getBillingProviderEnvironment(provider) !== environment) {
    throw new BillingConfigurationError("Billing environment does not match the stored provider binding.")
  }
  return { provider, environment }
}

export function canStartBillingCheckout(workspaceId: string) {
  if (isBillingDeferred()) return false
  return getBillingProviderName() === "paddle" ? isBillingProviderConfigured() && canStartPaddleCheckout(workspaceId) : true
}

export function assertBillingCheckoutEnabled(workspaceId: string) {
  if (!canStartBillingCheckout(workspaceId)) {
    throw new BillingConfigurationError("Checkout is temporarily unavailable.", "BILLING_DEFERRED")
  }
}

export function isSubscriptionManagementEnabled(provider = getBillingProviderName()) {
  return provider === "stripe" || isBillingProviderConfigured(provider)
}

export function assertSubscriptionManagementEnabled(provider?: SupportedBillingProvider) {
  assertBillingMutationsEnabled()
  if (!isSubscriptionManagementEnabled(provider)) {
    throw new BillingConfigurationError("Subscription management is unavailable in this checkout pilot.")
  }
}
