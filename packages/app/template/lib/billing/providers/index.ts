import "server-only"

import type { BillingProviderName, BillingProviderAdapter } from "../provider"
import { BillingConfigurationError, getBillingEnvironment, isStripeBillingConfigured } from "../config"
import { createPaddleSandboxAdapter, getPaddleSandboxConfig } from "./paddle"
import { createStripeBillingAdapter } from "./stripe"

/** Resolve the configured provider behind the product's vendor-neutral API. */
export function getBillingProviderName(): BillingProviderName {
  const provider = process.env.SAAS_CORE_BILLING_PROVIDER?.trim() || "stripe"
  if (provider === "stripe" || provider === "paddle") return provider
  throw new BillingConfigurationError("Unknown billing provider.")
}

export function getBillingProviderEnvironment() {
  return getBillingProviderName() === "paddle" ? getPaddleSandboxConfig().environment : getBillingEnvironment()
}

export function isBillingProviderConfigured() {
  try {
    return getBillingProviderName() === "paddle" ? Boolean(getPaddleSandboxConfig()) : isStripeBillingConfigured()
  } catch {
    return false
  }
}

export function getBillingProviderAdapter(): BillingProviderAdapter {
  return getBillingProviderName() === "paddle" ? createPaddleSandboxAdapter() : createStripeBillingAdapter()
}

export function isSubscriptionManagementEnabled() {
  return getBillingProviderName() === "stripe" || isBillingProviderConfigured()
}

export function assertSubscriptionManagementEnabled() {
  if (!isSubscriptionManagementEnabled()) {
    throw new BillingConfigurationError("Subscription management is unavailable in this checkout pilot.")
  }
}
