import "server-only"

import { normalizeDnsTarget } from "@/lib/domains/hostname"

/**
 * The customer-facing CNAME is a platform-owned DNS alias. Keep it in one
 * server-side configuration value so the UI cannot invent a target that is
 * not backed by the platform DNS setup.
 */
export function getCustomDomainTarget() {
  const configured = process.env.SAAS_CORE_CUSTOM_DOMAIN_TARGET?.trim()
  return configured ? normalizeDnsTarget(configured) : null
}

export function isCustomDomainSetupConfigured() {
  return Boolean(getCustomDomainTarget())
}
