import "server-only"

import type { BillingProviderName, BillingProviderAdapter } from "../provider"
import { getBillingEnvironment, isStripeBillingConfigured } from "../config"
import { createStripeBillingAdapter } from "./stripe"

/** Resolve the configured provider behind the product's vendor-neutral API. */
export function getBillingProviderName(): BillingProviderName {
  return "stripe"
}

export function getBillingProviderEnvironment() {
  return getBillingEnvironment()
}

export function isBillingProviderConfigured() {
  return isStripeBillingConfigured()
}

export function getBillingProviderAdapter(): BillingProviderAdapter {
  return createStripeBillingAdapter()
}
