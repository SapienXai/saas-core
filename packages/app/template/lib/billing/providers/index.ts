import "server-only"

import type { BillingProviderName, BillingProviderAdapter } from "../provider"
import { BillingConfigurationError, assertBillingMutationsEnabled, getBillingEnvironment, isStripeBillingConfigured, isBillingDeferred } from "../config"
import { canStartPaddleCheckout, createPaddleAdapter, getPaddleConfig, isPaddleBillingConfigured } from "./paddle"
import { createStripeBillingAdapter } from "./stripe"

/** Resolve the configured provider behind the product's vendor-neutral API. */
export function getBillingProviderName(): BillingProviderName {
  const provider = process.env.SAAS_CORE_BILLING_PROVIDER?.trim() || "stripe"
  if (provider === "stripe" || provider === "paddle") return provider
  throw new BillingConfigurationError("Unknown billing provider.")
}

export function getBillingProviderEnvironment() {
  return getBillingProviderName() === "paddle" ? getPaddleConfig().environment : getBillingEnvironment()
}

export function isBillingProviderConfigured() {
  try {
    return getBillingProviderName() === "paddle" ? isPaddleBillingConfigured() : isStripeBillingConfigured()
  } catch {
    return false
  }
}

export function getBillingProviderAdapter(): BillingProviderAdapter {
  return getBillingProviderName() === "paddle" ? createPaddleAdapter() : createStripeBillingAdapter()
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

export function isSubscriptionManagementEnabled() {
  return getBillingProviderName() === "stripe" || isBillingProviderConfigured()
}

export function assertSubscriptionManagementEnabled() {
  assertBillingMutationsEnabled()
  if (!isSubscriptionManagementEnabled()) {
    throw new BillingConfigurationError("Subscription management is unavailable in this checkout pilot.")
  }
}
