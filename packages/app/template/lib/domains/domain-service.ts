import "server-only"

import { isCoreProductKey, type CoreDomain, type CoreHostResolution, type CoreListDomainsInput, type CorePublicSite, type CorePlatformSubdomainInput } from "@sapienx/saas-core"
import { can, EntitlementError, getWorkspaceEntitlements } from "@/lib/entitlements"
import { getCurrentWorkspace, requireWorkspaceRole } from "@/lib/authorization"
import {
  buildPlatformHostname,
  getConfiguredRootDomain,
  getCustomerHostnameParts,
  getTrustedRequestHost,
  HostnameValidationError,
  normalizeHostname,
} from "@/lib/domains/hostname"
import { getCustomDomainTarget, isCustomDomainSetupConfigured } from "@/lib/domains/domain-config"
import { createServiceRoleClient } from "@/lib/supabase"
import { addProjectDomain, getProjectDomain, isVercelProviderConfigured, removeProjectDomain, verifyProjectDomain, type VercelDomainOperationResult, VercelProviderError } from "@/lib/domains/vercel"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export type DomainDnsInstructions = {
  verification: Array<{ type: string; domain: string; value: string; reason: string }>
  configuredBy: string | null
  misconfigured: boolean | null
  recommendedIPv4: Array<{ rank: number; value: string[] }>
  recommendedCNAME: Array<{ rank: number; value: string }>
}

export type WorkspacePublicSiteRecord = {
  id: string
  workspace_id: string
  product_key: string
  created_at: string
  updated_at: string
}

export type WorkspaceDomainRecord = {
  id: string
  workspace_id: string
  site_id: string
  hostname: string
  normalized_hostname: string
  type: "platform_subdomain" | "custom"
  status: string
  is_primary: boolean
  verification_token: string | null
  verification_metadata: Record<string, unknown>
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
  readonly code:
    | "INVALID_HOSTNAME"
    | "INVALID_SLUG"
    | "APEX_NOT_SUPPORTED"
    | "ENTITLEMENT"
    | "CONFLICT"
    | "DOMAIN_ALREADY_OWNED"
    | "DOMAIN_RELEASING"
    | "DOMAIN_MAPPING_CONFLICT"
    | "PLATFORM_DOMAIN_EXISTS"
    | "PLATFORM_DOMAIN_NOT_FOUND"
    | "PUBLIC_SITE_NOT_FOUND"
    | "NOT_FOUND"
    | "PROVIDER"
    | "CONFIGURATION"

  constructor(code: DomainServiceError["code"], message: string) {
    super(message)
    this.name = "DomainServiceError"
    this.code = code
  }
}

const selectFields = "id, workspace_id, site_id, hostname, normalized_hostname, type, status, is_primary, verification_token, verification_metadata, provider, provider_environment, verification_state, provider_verified, dns_configured, verified_at, last_checked_at, last_error_code, last_error_message, created_at, updated_at"
const siteSelectFields = "id, workspace_id, product_key, created_at, updated_at"
const DEFAULT_PRODUCT_KEY = PRODUCT_CONFIG.slug

function nowIso() {
  return new Date().toISOString()
}

function toCoreSite(site: WorkspacePublicSiteRecord): CorePublicSite {
  return {
    id: site.id,
    workspaceId: site.workspace_id,
    productKey: site.product_key,
    createdAt: site.created_at,
    updatedAt: site.updated_at,
  }
}

function toCoreDomain(domain: WorkspaceDomainRecord): CoreDomain {
  const status = ["pending", "verifying", "active", "failed", "error", "removing", "removed"].includes(domain.status)
    ? domain.status
    : "failed"
  return {
    id: domain.id,
    workspaceId: domain.workspace_id,
    siteId: domain.site_id,
    hostname: domain.hostname,
    normalizedHostname: domain.normalized_hostname,
    type: domain.type,
    status: status as CoreDomain["status"],
    isPrimary: domain.is_primary,
    verificationToken: domain.verification_token,
    verificationMetadata: domain.verification_metadata,
    verifiedAt: domain.verified_at,
    createdAt: domain.created_at,
    updatedAt: domain.updated_at,
  }
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

function providerError(error: unknown): DomainServiceError {
  if (error instanceof VercelProviderError && error.code === "NOT_CONFIGURED") return new DomainServiceError("CONFIGURATION", error.message)
  if (error instanceof VercelProviderError && error.code === "DOMAIN_RELEASING") return new DomainServiceError("DOMAIN_RELEASING", "This domain is still being released by the provider. Try again shortly.")
  if (error instanceof VercelProviderError && error.code === "DOMAIN_CONFLICT") return new DomainServiceError("DOMAIN_ALREADY_OWNED", "This domain is already assigned to another provider project.")
  return new DomainServiceError("PROVIDER", error instanceof VercelProviderError ? error.message : "The domain provider is temporarily unavailable.")
}

function providerState(result: VercelDomainOperationResult) {
  const verified = result.domain.verified === true
  const dnsConfigured = Boolean(result.dns && !result.dns.misconfigured)
  return {
    status: verified && dnsConfigured ? "active" : "verifying",
    verification_state: verified ? "verified" : "pending",
    provider_verified: verified,
    dns_configured: dnsConfigured,
    verified_at: verified ? nowIso() : null,
  }
}

function customDomainCapability(features: Readonly<Record<string, boolean>>) {
  return Object.prototype.hasOwnProperty.call(features, "customDomain") ? "customDomain" : "custom_domains"
}

async function authorizedWorkspace(targetWorkspaceId?: string) {
  const current = targetWorkspaceId?.trim() || (await getCurrentWorkspace())?.workspace_id
  if (!current) throw new DomainServiceError("NOT_FOUND", "No active workspace is available.")
  await requireWorkspaceRole(current, ["owner", "admin"])
  return current
}

async function activeWorkspace() {
  return authorizedWorkspace()
}

async function findPublicSite(workspaceId: string, siteId?: string, productKey?: string) {
  let query = createServiceRoleClient().from("public_sites").select(siteSelectFields).eq("workspace_id", workspaceId)
  query = siteId ? query.eq("id", siteId) : query.eq("product_key", productKey || DEFAULT_PRODUCT_KEY)
  const { data, error } = await query.order("created_at", { ascending: true }).limit(1)
  if (error) throw new DomainServiceError("PROVIDER", "Public site configuration could not be loaded.")
  return (data?.[0] || null) as WorkspacePublicSiteRecord | null
}

async function ensurePublicSite(input: { workspaceId: string; siteId?: string; productKey?: string }) {
  const productKey = input.productKey?.trim() || DEFAULT_PRODUCT_KEY
  if (!isCoreProductKey(productKey)) throw new DomainServiceError("INVALID_SLUG", "The product key is invalid.")
  const existing = await findPublicSite(input.workspaceId, input.siteId, productKey)
  if (existing) {
    if (existing.product_key !== productKey) throw new DomainServiceError("PUBLIC_SITE_NOT_FOUND", "The public site does not belong to this product.")
    return existing
  }
  if (input.siteId) throw new DomainServiceError("PUBLIC_SITE_NOT_FOUND", "The public site could not be found.")
  const { data, error } = await createServiceRoleClient()
    .from("public_sites")
    .insert({ workspace_id: input.workspaceId, product_key: productKey })
    .select(siteSelectFields)
    .single()
  if (!error && data) return data as WorkspacePublicSiteRecord
  if (error?.code === "23505") {
    const concurrent = await findPublicSite(input.workspaceId, undefined, productKey)
    if (concurrent) return concurrent
  }
  throw new DomainServiceError("PROVIDER", "The public site could not be created.")
}

async function listDomainRows(workspaceId: string, siteId?: string) {
  let query = createServiceRoleClient().from("workspace_domains").select(selectFields).eq("workspace_id", workspaceId)
  if (siteId) query = query.eq("site_id", siteId)
  const { data, error } = await query.order("created_at", { ascending: true }).order("id", { ascending: true })
  if (error) throw new DomainServiceError("PROVIDER", "Domain configuration could not be loaded.")
  return (data || []) as WorkspaceDomainRecord[]
}

async function loadDomain(workspaceId: string, siteId: string) {
  const domains = await listDomainRows(workspaceId, siteId)
  return domains.find((domain) => domain.type === "custom" && domain.status !== "removed") || null
}

async function loadDomainById(domainId: string) {
  const { data, error } = await createServiceRoleClient().from("workspace_domains").select(selectFields).eq("id", domainId).maybeSingle()
  if (error) throw new DomainServiceError("PROVIDER", "Domain configuration could not be loaded.")
  return data as WorkspaceDomainRecord | null
}

async function loadByHostname(hostname: string) {
  const { data, error } = await createServiceRoleClient().from("workspace_domains").select(selectFields).eq("normalized_hostname", hostname).maybeSingle()
  if (error) throw new DomainServiceError("PROVIDER", "Domain configuration could not be checked.")
  return data as WorkspaceDomainRecord | null
}

async function instructions(domain: WorkspaceDomainRecord | null) {
  if (!domain || domain.status === "removed" || !isVercelProviderConfigured()) return null
  try {
    return dnsInstructions(await getProjectDomain(domain.hostname))
  } catch {
    return null
  }
}

async function saveProviderState(workspaceId: string, domainId: string, hostname: string, result: VercelDomainOperationResult) {
  const state = providerState(result)
  const { data, error } = await createServiceRoleClient()
    .from("workspace_domains")
    .update({ hostname, normalized_hostname: hostname, type: "custom", ...state, last_checked_at: nowIso(), last_error_code: null, last_error_message: null })
    .eq("id", domainId)
    .eq("workspace_id", workspaceId)
    .select(selectFields)
    .single()
  if (error || !data) throw new DomainServiceError("PROVIDER", "Domain state could not be saved.")
  return { domain: data as WorkspaceDomainRecord, instructions: dnsInstructions(result) }
}

function mapPlatformRpcError(error: { code?: string; message?: string }) {
  const message = error.message || ""
  if (message.includes("DOMAIN_HOSTNAME_INVALID")) return new DomainServiceError("INVALID_HOSTNAME", "The platform hostname is invalid.")
  if (message.includes("PUBLIC_SITE_NOT_FOUND")) return new DomainServiceError("PUBLIC_SITE_NOT_FOUND", "The public site could not be found.")
  if (message.includes("PLATFORM_DOMAIN_EXISTS")) return new DomainServiceError("PLATFORM_DOMAIN_EXISTS", "This public site already has another platform address.")
  if (message.includes("PLATFORM_DOMAIN_NOT_FOUND")) return new DomainServiceError("PLATFORM_DOMAIN_NOT_FOUND", "No platform address exists for this public site.")
  if (message.includes("DOMAIN_HOSTNAME_CONFLICT")) return new DomainServiceError("CONFLICT", "That hostname is already claimed by another workspace.")
  return new DomainServiceError("PROVIDER", "The platform domain operation could not be completed.")
}

async function preparePlatformDomain(input: CorePlatformSubdomainInput) {
  const workspaceId = await authorizedWorkspace(input.workspaceId)
  const productKey = input.productKey?.trim() || DEFAULT_PRODUCT_KEY
  if (!isCoreProductKey(productKey)) throw new DomainServiceError("INVALID_SLUG", "The product key is invalid.")
  let hostname: string
  try {
    hostname = buildPlatformHostname(input.slug, input.rootDomain)
  } catch (error) {
    throw new DomainServiceError(error instanceof HostnameValidationError && error.message.includes("reserved") ? "INVALID_SLUG" : "INVALID_HOSTNAME", error instanceof HostnameValidationError ? error.message : "The platform hostname is invalid.")
  }
  const site = await ensurePublicSite({ workspaceId, siteId: input.siteId, productKey })
  return { workspaceId, productKey, hostname, site }
}

async function callPlatformDomain(input: CorePlatformSubdomainInput, replaceExisting: boolean) {
  const prepared = await preparePlatformDomain(input)
  const current = (await listDomainRows(prepared.workspaceId, prepared.site.id)).find((domain) => domain.type === "platform_subdomain") || null
  const { data, error } = await createServiceRoleClient().rpc("claim_platform_subdomain", {
    target_workspace_id: prepared.workspaceId,
    target_site_id: prepared.site.id,
    target_hostname: prepared.hostname,
    target_replace_existing: replaceExisting,
  })
  if (error) throw mapPlatformRpcError(error)
  const row = (Array.isArray(data) ? data[0] : data) as { domain_id?: string } | null
  if (!row?.domain_id) throw new DomainServiceError("PROVIDER", "The platform domain operation returned no domain.")
  const domain = await loadDomainById(row.domain_id)
  if (!domain) throw new DomainServiceError("PROVIDER", "The platform domain could not be loaded.")
  return {
    site: toCoreSite(prepared.site),
    domain: toCoreDomain(domain),
    idempotent: current?.normalized_hostname === prepared.hostname && current.status === "active",
  }
}

export async function listDomains(input: CoreListDomainsInput): Promise<readonly CoreDomain[]> {
  const workspaceId = await authorizedWorkspace(input.workspaceId)
  const site = await findPublicSite(workspaceId, input.siteId)
  if (!site) throw new DomainServiceError("PUBLIC_SITE_NOT_FOUND", "The public site could not be found.")
  return (await listDomainRows(workspaceId, site.id)).map(toCoreDomain)
}

export async function claimPlatformSubdomain(input: CorePlatformSubdomainInput) {
  return callPlatformDomain(input, false)
}

export async function changePlatformSubdomain(input: CorePlatformSubdomainInput) {
  const prepared = await preparePlatformDomain(input)
  const current = (await listDomainRows(prepared.workspaceId, prepared.site.id)).find((domain) => domain.type === "platform_subdomain") || null
  if (!current) throw new DomainServiceError("PLATFORM_DOMAIN_NOT_FOUND", "No platform address exists for this public site.")
  const result = await callPlatformDomain(input, true)
  return { ...result, idempotent: result.idempotent || current.normalized_hostname === result.domain.normalizedHostname }
}

export async function ensurePlatformSubdomain(workspaceId: string, slug: string, productKey = DEFAULT_PRODUCT_KEY) {
  try {
    return await claimPlatformSubdomain({ workspaceId, productKey, slug })
  } catch {
    return null
  }
}

export async function resolveHost(hostname: string): Promise<CoreHostResolution | null> {
  let normalizedHostname: string
  try {
    normalizedHostname = normalizeHostname(hostname, { allowPlatform: true, allowDevelopment: true })
  } catch {
    return null
  }
  const { data, error } = await createServiceRoleClient().rpc("resolve_domain_host", { target_normalized_hostname: normalizedHostname })
  if (error) throw mapPlatformRpcError(error)
  const row = (Array.isArray(data) ? data[0] : data) as {
    domain_id?: string
    site_id?: string
    workspace_id?: string
    product_key?: string
    hostname?: string
    normalized_hostname?: string
    domain_type?: string
    is_primary?: boolean
    workspace_slug?: string
    workspace_name?: string
  } | null
  if (!row) return null
  if (!row.domain_id || !row.site_id || !row.workspace_id || !row.product_key || !row.hostname || !row.normalized_hostname) {
    throw new DomainServiceError("PROVIDER", "The hostname resolution result is invalid.")
  }
  if (row.domain_type !== "platform_subdomain" && row.domain_type !== "custom") {
    throw new DomainServiceError("PROVIDER", "The hostname resolution result is invalid.")
  }
  return {
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    productKey: row.product_key,
    domainId: row.domain_id,
    hostname: row.hostname,
    normalizedHostname: row.normalized_hostname,
    domainType: row.domain_type,
    isPrimary: Boolean(row.is_primary),
    workspaceSlug: row.workspace_slug,
    workspaceName: row.workspace_name,
  }
}

export async function resolveHostRequest(request: Request) {
  const trusted = getTrustedRequestHost(request)
  return trusted ? resolveHost(trusted.hostname) : null
}

export async function getWorkspaceDomainManagementData() {
  const workspaceId = await activeWorkspace()
  const workspaceResult = await createServiceRoleClient().from("workspaces").select("id, name, slug").eq("id", workspaceId).single()
  if (workspaceResult.error || !workspaceResult.data) throw new DomainServiceError("NOT_FOUND", "Workspace could not be loaded.")
  const workspace = workspaceResult.data as { id: string; name: string; slug: string }
  const site = await ensurePublicSite({ workspaceId, productKey: DEFAULT_PRODUCT_KEY })
  const [entitlements, domains] = await Promise.all([getWorkspaceEntitlements(workspaceId), listDomainRows(workspaceId, site.id)])
  const domain = domains.find((item) => item.type === "custom" && item.status !== "removed") || null
  const platformDomain = domains.find((item) => item.type === "platform_subdomain") || null
  const rootDomain = getConfiguredRootDomain()
  let expectedHostname = workspace.slug + "." + rootDomain
  try {
    expectedHostname = buildPlatformHostname(workspace.slug, rootDomain)
  } catch {
    // A legacy workspace slug may no longer satisfy the stricter platform rule.
  }
  return {
    workspace,
    site: toCoreSite(site),
    domains: domains.map(toCoreDomain),
    domain,
    platformDomain: platformDomain ? toCoreDomain(platformDomain) : null,
    hostedUrl: "https://" + (platformDomain?.hostname || expectedHostname),
    rootDomain,
    productKey: site.product_key,
    instructions: await instructions(domain),
    customDomainEnabled: Boolean(entitlements.features.customDomain ?? entitlements.features.custom_domains),
    customDomainTarget: getCustomDomainTarget(),
    providerConfigured: isVercelProviderConfigured(),
  }
}

export async function connectWorkspaceDomain(rawHostname: string) {
  const workspaceId = await activeWorkspace()
  const entitlements = await getWorkspaceEntitlements(workspaceId)
  if (!(await can(workspaceId, customDomainCapability(entitlements.features)))) throw new DomainServiceError("ENTITLEMENT", "Custom domains are available on paid plans.")
  let hostname: string
  try {
    hostname = normalizeHostname(rawHostname)
  } catch (error) {
    throw new DomainServiceError("INVALID_HOSTNAME", error instanceof HostnameValidationError ? error.message : "Enter a valid hostname.")
  }
  const parts = getCustomerHostnameParts(hostname)
  if (!parts || parts.isApex) throw new DomainServiceError("APEX_NOT_SUPPORTED", "Custom domains support subdomains, such as app.example.com.")
  if (!isCustomDomainSetupConfigured() || !isVercelProviderConfigured()) throw new DomainServiceError("CONFIGURATION", "Custom domain management is not configured for this environment.")
  const site = await ensurePublicSite({ workspaceId, productKey: DEFAULT_PRODUCT_KEY })
  const domains = await listDomainRows(workspaceId, site.id)
  const current = domains.find((domain) => domain.type === "custom" && domain.status !== "removed") || null
  if (current && current.status !== "removed" && current.status !== "removing" && current.hostname !== hostname) throw new DomainServiceError("DOMAIN_MAPPING_CONFLICT", "This workspace already has another custom domain.")
  if (current?.hostname === hostname && current.status !== "removed" && current.status !== "removing") {
    try {
      return { ...(await saveProviderState(workspaceId, current.id, hostname, await getProjectDomain(hostname))), idempotent: true }
    } catch (error) {
      if (!(error instanceof VercelProviderError && error.code === "DOMAIN_NOT_FOUND")) return { domain: current, instructions: await instructions(current), idempotent: true }
    }
  }
  const existing = await loadByHostname(hostname)
  if (existing && existing.id !== current?.id && existing.status !== "removed") throw new DomainServiceError("DOMAIN_ALREADY_OWNED", "This domain is already connected to another workspace.")
  let result: VercelDomainOperationResult
  try {
    result = await addProjectDomain(hostname)
  } catch (error) {
    if (error instanceof VercelProviderError && error.code === "DOMAIN_CONFLICT") {
      try {
        result = await getProjectDomain(hostname)
      } catch (lookupError) {
        throw providerError(lookupError)
      }
    } else throw providerError(error)
  }
  const state = providerState(result)
  const service = createServiceRoleClient()
  const query = current && current.status === "removed"
    ? service.from("workspace_domains").update({ site_id: site.id, hostname, normalized_hostname: hostname, type: "custom", ...state, last_checked_at: nowIso(), last_error_code: null, last_error_message: null }).eq("id", current.id).eq("workspace_id", workspaceId)
    : service.from("workspace_domains").insert({ workspace_id: workspaceId, site_id: site.id, hostname, normalized_hostname: hostname, type: "custom", is_primary: false, ...state, provider: "vercel", provider_environment: "production", last_checked_at: nowIso() })
  const { data, error } = await query.select(selectFields).single()
  if (error || !data) {
    if (error?.code === "23505") throw new DomainServiceError("CONFLICT", "That hostname is already claimed by another workspace.")
    throw new DomainServiceError("PROVIDER", "Domain mapping could not be saved.")
  }
  return { domain: data as WorkspaceDomainRecord, instructions: dnsInstructions(result), idempotent: false }
}

export async function refreshWorkspaceDomain() {
  const workspaceId = await activeWorkspace()
  const site = await ensurePublicSite({ workspaceId, productKey: DEFAULT_PRODUCT_KEY })
  const domain = await loadDomain(workspaceId, site.id)
  if (!domain || domain.status === "removed") throw new DomainServiceError("NOT_FOUND", "No custom domain is connected.")
  if (!isVercelProviderConfigured()) throw new DomainServiceError("CONFIGURATION", "Domain provider is not configured.")
  try {
    let result = await getProjectDomain(domain.hostname)
    if (!result.domain.verified) {
      try { result = await verifyProjectDomain(domain.hostname) } catch { /* DNS may still be propagating. */ }
    }
    return saveProviderState(workspaceId, domain.id, domain.hostname, result)
  } catch (error) {
    const failure = providerError(error)
    await createServiceRoleClient().from("workspace_domains").update({
      status: failure.code === "CONFIGURATION" ? domain.status : "error",
      verification_state: failure.code === "CONFIGURATION" ? domain.verification_state : "failed",
      last_checked_at: nowIso(),
      last_error_code: failure.code,
      last_error_message: failure.message,
    }).eq("id", domain.id)
    throw failure
  }
}

export async function removeWorkspaceDomain() {
  const workspaceId = await activeWorkspace()
  const site = await ensurePublicSite({ workspaceId, productKey: DEFAULT_PRODUCT_KEY })
  const domain = await loadDomain(workspaceId, site.id)
  if (!domain || domain.status === "removed") return { success: true as const }
  if (!isVercelProviderConfigured()) throw new DomainServiceError("CONFIGURATION", "Domain provider is not configured.")
  await createServiceRoleClient().from("workspace_domains").update({ status: "removing", last_checked_at: nowIso() }).eq("id", domain.id)
  try {
    await removeProjectDomain(domain.hostname)
    const { error } = await createServiceRoleClient().from("workspace_domains").delete().eq("id", domain.id)
    if (error) throw new Error(error.message)
    return { success: true as const }
  } catch (error) {
    const failure = providerError(error)
    await createServiceRoleClient().from("workspace_domains").update({
      status: failure.code === "CONFIGURATION" ? domain.status : "error",
      last_checked_at: nowIso(),
      last_error_code: failure.code,
      last_error_message: failure.message,
    }).eq("id", domain.id)
    throw failure
  }
}

export function domainErrorMessage(error: unknown) {
  return error instanceof DomainServiceError || error instanceof EntitlementError ? error.message : "Domain management is temporarily unavailable."
}
