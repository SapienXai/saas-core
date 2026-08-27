import "server-only"

import { requireRestaurantManagementAccess } from "@/lib/authorization"
import { can, EntitlementError, getWorkspaceEntitlements } from "@/lib/entitlements"
import { normalizeHostname, HostnameValidationError } from "@/lib/domains/hostname"
import { getCustomerHostnameParts } from "@/lib/domains/hostname"
import { getCustomDomainTarget, isCustomDomainSetupConfigured } from "@/lib/domains/domain-config"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  addProjectDomain,
  getProjectDomain,
  isVercelProviderConfigured,
  removeProjectDomain,
  verifyProjectDomain,
  type VercelDomainOperationResult,
  VercelProviderError,
} from "@/lib/domains/vercel"

export type DomainDnsInstructions = {
  verification: Array<{ type: string; domain: string; value: string; reason: string }>
  configuredBy: string | null
  misconfigured: boolean | null
  recommendedIPv4: Array<{ rank: number; value: string[] }>
  recommendedCNAME: Array<{ rank: number; value: string }>
}

export type RestaurantDomainRecord = {
  id: string
  restaurant_id: string
  public_surface: "restaurant" | "brand"
  hostname: string
  status: string
  provider: string
  provider_environment: string
  verification_state: string
  provider_verified: boolean
  dns_configured: boolean
  verified_at: string | null
  last_checked_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}

export class DomainServiceError extends Error {
  readonly code: "INVALID_HOSTNAME" | "APEX_NOT_SUPPORTED" | "ENTITLEMENT" | "CONFLICT" | "DOMAIN_ALREADY_OWNED" | "DOMAIN_RELEASING" | "DOMAIN_LOCAL_CONFLICT" | "DOMAIN_MAPPING_CONFLICT" | "NOT_FOUND" | "PROVIDER" | "CONFIGURATION"

  constructor(code: DomainServiceError["code"], message: string) {
    super(message)
    this.name = "DomainServiceError"
    this.code = code
  }
}

function nowIso() {
  return new Date().toISOString()
}

function safeProviderMessage(error: unknown) {
  if (error instanceof VercelProviderError) return error.message
  return "The domain provider is temporarily unavailable."
}

function providerServiceError(error: unknown) {
  if (error instanceof VercelProviderError && error.code === "NOT_CONFIGURED") {
    return new DomainServiceError("CONFIGURATION", error.message)
  }
  if (error instanceof VercelProviderError && error.code === "DOMAIN_RELEASING") {
    return new DomainServiceError("DOMAIN_RELEASING", "This domain is still being released by the provider. Wait a little longer, then try again.")
  }
  if (error instanceof VercelProviderError && error.code === "DOMAIN_CONFLICT") {
    return new DomainServiceError("DOMAIN_ALREADY_OWNED", "This domain is connected to another provider project or team. Remove that assignment there before connecting it here.")
  }
  return new DomainServiceError("PROVIDER", safeProviderMessage(error))
}

function dnsInstructions(result: VercelDomainOperationResult | null): DomainDnsInstructions | null {
  if (!result) return null
  return {
    verification: result.domain.verification || [],
    configuredBy: result.dns?.configuredBy || null,
    misconfigured: result.dns?.misconfigured ?? null,
    recommendedIPv4: result.dns?.recommendedIPv4 || [],
    recommendedCNAME: result.dns?.recommendedCNAME || [],
  }
}

function resultState(result: VercelDomainOperationResult) {
  const providerVerified = result.domain.verified === true
  const dnsConfigured = Boolean(result.dns && !result.dns.misconfigured)
  return {
    status: providerVerified && dnsConfigured ? "active" : "verifying",
    verification_state: providerVerified ? "verified" : "pending",
    provider_verified: providerVerified,
    dns_configured: dnsConfigured,
    verified_at: providerVerified ? nowIso() : null,
  }
}

async function assertDomainManagement(restaurantId: string) {
  const access = await requireRestaurantManagementAccess(restaurantId, ["owner", "admin"])
  if (!access.restaurant.workspace_id) throw new DomainServiceError("NOT_FOUND", "Restaurant could not be loaded.")
  if (!(await can(access.restaurant.workspace_id, "customDomain"))) {
    throw new DomainServiceError("ENTITLEMENT", "Custom domains are available on Starter and higher plans.")
  }
  return { ...access, workspaceId: access.restaurant.workspace_id }
}

async function loadDomain(restaurantId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("restaurant_domains")
    .select("id, restaurant_id, hostname, public_surface, status, provider, provider_environment, verification_state, provider_verified, dns_configured, verified_at, last_checked_at, last_error_code, last_error_message, created_at, updated_at")
    .eq("restaurant_id", restaurantId)
    .maybeSingle()
  if (error) throw new DomainServiceError("PROVIDER", "Domain configuration could not be loaded.")
  return data as RestaurantDomainRecord | null
}

async function loadDomainByHostname(hostname: string) {
  const { data, error } = await createServiceRoleClient()
    .from("restaurant_domains")
    .select("id, restaurant_id, hostname, public_surface, status, provider, provider_environment, verification_state, provider_verified, dns_configured, verified_at, last_checked_at, last_error_code, last_error_message, created_at, updated_at")
    .eq("hostname", hostname)
    .maybeSingle()
  if (error) throw new DomainServiceError("PROVIDER", "Domain configuration could not be checked.")
  return data as RestaurantDomainRecord | null
}

async function loadDomainInstructions(domain: RestaurantDomainRecord | null) {
  if (!domain || domain.status === "removed" || !isVercelProviderConfigured()) return null
  try {
    const result = await getProjectDomain(domain.hostname)
    return dnsInstructions(result)
  } catch {
    // The management screen can still render the saved connection state when
    // the provider is temporarily unavailable. Refresh will retry the lookup.
    return null
  }
}

async function persistProviderResult(restaurantId: string, hostname: string, result: VercelDomainOperationResult, publicSurface: "restaurant" | "brand" = "restaurant") {
  const state = resultState(result)
  const { data, error } = await createServiceRoleClient()
    .from("restaurant_domains")
    .update({
      hostname,
      public_surface: publicSurface,
      ...state,
      last_checked_at: nowIso(),
      last_error_code: null,
      last_error_message: null,
    })
    .eq("restaurant_id", restaurantId)
    .select("id, restaurant_id, hostname, public_surface, status, provider, provider_environment, verification_state, provider_verified, dns_configured, verified_at, last_checked_at, last_error_code, last_error_message, created_at, updated_at")
    .single()
  if (error || !data) throw new DomainServiceError("PROVIDER", "Domain state could not be saved.")
  return { domain: data as RestaurantDomainRecord, instructions: dnsInstructions(result) }
}

export async function getRestaurantDomainManagementData(restaurantId: string) {
  const access = await requireRestaurantManagementAccess(restaurantId, ["owner", "admin"])
  const restaurant = access.restaurant
  if (!restaurant.workspace_id) throw new DomainServiceError("NOT_FOUND", "Restaurant could not be loaded.")
  const [entitlements, domain] = await Promise.all([
    getWorkspaceEntitlements(restaurant.workspace_id),
    loadDomain(restaurantId),
  ])
  const instructions = await loadDomainInstructions(domain)
  return {
    restaurant,
    domain,
    instructions,
    canManage: access.membership?.role === "owner" || access.membership?.role === "admin" || access.access.isSuperAdmin,
    customDomainEnabled: entitlements.features.customDomain,
    customDomainTarget: getCustomDomainTarget(),
  }
}

export async function connectRestaurantDomain(restaurantId: string, rawHostname: string, publicSurface: "restaurant" | "brand" = "restaurant") {
  const access = await assertDomainManagement(restaurantId)
  const restaurant = access.restaurant
  if (!restaurant.workspace_id) throw new DomainServiceError("NOT_FOUND", "Restaurant could not be loaded.")
  if (publicSurface === "brand" && !(await can(access.workspaceId, "multiRestaurant"))) {
    throw new DomainServiceError("ENTITLEMENT", "Workspace-wide booking links are not included in the current plan.")
  }
  let hostname: string
  try {
    hostname = normalizeHostname(rawHostname)
  } catch (error) {
    throw new DomainServiceError("INVALID_HOSTNAME", error instanceof HostnameValidationError ? error.message : "Enter a valid hostname.")
  }

  const hostnameParts = getCustomerHostnameParts(hostname)
  if (!hostnameParts || hostnameParts.isApex) {
    throw new DomainServiceError("APEX_NOT_SUPPORTED", "Reservevia custom domains currently support subdomains only, such as booking.example.com.")
  }
  if (!isCustomDomainSetupConfigured()) {
    throw new DomainServiceError("CONFIGURATION", "The customer DNS target is not configured. Configure RESERVEVIA_CUSTOM_DOMAIN_TARGET before adding a custom domain.")
  }

  const existingForRestaurant = await loadDomain(restaurantId)
  if (existingForRestaurant && existingForRestaurant.hostname === hostname && existingForRestaurant.status !== "removed" && existingForRestaurant.status !== "removing") {
    if (isVercelProviderConfigured()) {
      try {
        const providerResult = await getProjectDomain(hostname)
        const persisted = await persistProviderResult(restaurantId, hostname, providerResult, publicSurface)
        return { ...persisted, idempotent: true }
      } catch (error) {
        if (!(error instanceof VercelProviderError && error.code === "DOMAIN_NOT_FOUND")) {
          return { domain: existingForRestaurant, instructions: await loadDomainInstructions(existingForRestaurant), idempotent: true }
        }
        // The local row is stale: continue through the provider add flow so a
        // removed provider mapping can be safely re-created.
      }
    } else {
      return { domain: existingForRestaurant, instructions: await loadDomainInstructions(existingForRestaurant), idempotent: true }
    }
  }
  if (existingForRestaurant && existingForRestaurant.status === "removing") {
    throw new DomainServiceError("DOMAIN_RELEASING", "The existing domain is still being removed. Refresh and try again shortly.")
  }
  if (existingForRestaurant && existingForRestaurant.status !== "removed" && existingForRestaurant.hostname !== hostname) {
    throw new DomainServiceError("DOMAIN_MAPPING_CONFLICT", "This restaurant already has another custom domain. Remove it before connecting a new one.")
  }

  const existingHostname = await loadDomainByHostname(hostname)
  if (existingHostname && existingHostname.restaurant_id !== restaurantId && existingHostname.status !== "removed") {
    throw new DomainServiceError("DOMAIN_LOCAL_CONFLICT", "This domain is already connected to another Reservevia restaurant.")
  }

  if (!isVercelProviderConfigured()) {
    throw new DomainServiceError("CONFIGURATION", "Vercel domain management is not configured for this environment.")
  }

  let providerResult: VercelDomainOperationResult
  try {
    providerResult = await addProjectDomain(hostname)
  } catch (error) {
    console.error("Reservevia Vercel domain add failed", { restaurantId, workspaceId: access.workspaceId, hostname, code: error instanceof VercelProviderError ? error.code : "PROVIDER_ERROR" })
    if (error instanceof VercelProviderError && error.code === "DOMAIN_CONFLICT") {
      // Vercel returns 400 when the domain is already on this project. A
      // scoped read proves ownership without ever moving a domain between
      // projects, so treat that case as an idempotent retry.
      try {
        providerResult = await getProjectDomain(hostname)
      } catch (lookupError) {
        if (lookupError instanceof VercelProviderError && lookupError.code === "DOMAIN_RELEASING") {
          throw providerServiceError(lookupError)
        }
        if (lookupError instanceof VercelProviderError && lookupError.code === "DOMAIN_NOT_FOUND") {
          throw providerServiceError(error)
        }
        throw providerServiceError(lookupError)
      }
    } else {
      throw providerServiceError(error)
    }
  }

  const state = resultState(providerResult)
  const supabase = createServiceRoleClient()
  const query = existingForRestaurant
    ? supabase
      .from("restaurant_domains")
      .update({ hostname, public_surface: publicSurface, ...state, status: state.status, provider: "vercel", provider_environment: "production", verification_state: state.verification_state, last_checked_at: nowIso(), last_error_code: null, last_error_message: null, created_by: access.access.userId })
      .eq("id", existingForRestaurant.id)
    : supabase
      .from("restaurant_domains")
      .insert({ restaurant_id: restaurant.id, hostname, public_surface: publicSurface, status: state.status, provider: "vercel", provider_environment: "production", verification_state: state.verification_state, provider_verified: state.provider_verified, dns_configured: state.dns_configured, verified_at: state.verified_at, last_checked_at: nowIso(), created_by: access.access.userId })

  const { data, error } = await query
    .select("id, restaurant_id, hostname, public_surface, status, provider, provider_environment, verification_state, provider_verified, dns_configured, verified_at, last_checked_at, last_error_code, last_error_message, created_at, updated_at")
    .single()
  if (error || !data) {
    console.error("Reservevia custom domain mapping could not be saved", { restaurantId, hostname, code: error?.code })
    if (error?.code === "23505") {
      const mapping = await loadDomainByHostname(hostname)
      if (mapping?.restaurant_id === restaurantId && mapping.hostname === hostname) {
        return { domain: mapping, instructions: dnsInstructions(providerResult), idempotent: true }
      }
      const current = await loadDomain(restaurantId)
      if (current && current.status !== "removed" && current.hostname !== hostname) {
        throw new DomainServiceError("DOMAIN_MAPPING_CONFLICT", "This restaurant already has another custom domain. Remove it before connecting a new one.")
      }
      throw new DomainServiceError("DOMAIN_LOCAL_CONFLICT", "This domain is already connected to another Reservevia restaurant.")
    }
    throw new DomainServiceError("PROVIDER", "Domain mapping could not be saved.")
  }

  return { domain: data as RestaurantDomainRecord, instructions: dnsInstructions(providerResult), idempotent: false }
}

export async function refreshRestaurantDomain(restaurantId: string) {
  await assertDomainManagement(restaurantId)
  const domain = await loadDomain(restaurantId)
  if (!domain || domain.status === "removed") throw new DomainServiceError("NOT_FOUND", "No custom domain is connected.")
  if (!isVercelProviderConfigured()) throw new DomainServiceError("CONFIGURATION", "Vercel domain management is not configured for this environment.")

  try {
    let result = await getProjectDomain(domain.hostname)
    if (!result.domain.verified) {
      try {
        result = await verifyProjectDomain(domain.hostname)
      } catch {
        // DNS may not be ready yet; the existing project-domain response still
        // contains the verification challenge and is safe to display.
      }
    }
    return await persistProviderResult(restaurantId, domain.hostname, result, domain.public_surface)
  } catch (error) {
    const serviceError = providerServiceError(error)
    const message = serviceError.message
    await createServiceRoleClient()
      .from("restaurant_domains")
      .update({ status: serviceError.code === "CONFIGURATION" ? domain.status : "error", verification_state: serviceError.code === "CONFIGURATION" ? domain.verification_state : "failed", last_checked_at: nowIso(), last_error_code: serviceError.code, last_error_message: message })
      .eq("id", domain.id)
    throw serviceError
  }
}

export async function removeRestaurantDomain(restaurantId: string) {
  await assertDomainManagement(restaurantId)
  const domain = await loadDomain(restaurantId)
  if (!domain || domain.status === "removed") return { success: true }
  if (!isVercelProviderConfigured()) throw new DomainServiceError("CONFIGURATION", "Vercel domain management is not configured for this environment.")

  await createServiceRoleClient()
    .from("restaurant_domains")
    .update({ status: "removing", last_checked_at: nowIso() })
    .eq("id", domain.id)

  try {
    await removeProjectDomain(domain.hostname)
    const { error } = await createServiceRoleClient().from("restaurant_domains").delete().eq("id", domain.id)
    if (error) throw new Error(error.message)
    return { success: true }
  } catch (error) {
    const serviceError = providerServiceError(error)
    const message = serviceError.message
    await createServiceRoleClient()
      .from("restaurant_domains")
      .update({ status: serviceError.code === "CONFIGURATION" ? domain.status : "error", last_checked_at: nowIso(), last_error_code: serviceError.code, last_error_message: message })
      .eq("id", domain.id)
    throw serviceError
  }
}

export function domainErrorMessage(error: unknown) {
  if (error instanceof DomainServiceError || error instanceof EntitlementError) return error.message
  return "Domain management is temporarily unavailable."
}
