import "server-only"

import { can, EntitlementError, getWorkspaceEntitlements } from "@/lib/entitlements"
import { getCurrentWorkspace, requireWorkspaceRole } from "@/lib/authorization"
import { getCustomerHostnameParts, HostnameValidationError, normalizeHostname } from "@/lib/domains/hostname"
import { getCustomDomainTarget, isCustomDomainSetupConfigured } from "@/lib/domains/domain-config"
import { createServiceRoleClient } from "@/lib/supabase"
import { addProjectDomain, getProjectDomain, isVercelProviderConfigured, removeProjectDomain, verifyProjectDomain, type VercelDomainOperationResult, VercelProviderError } from "@/lib/domains/vercel"

export type DomainDnsInstructions = {
  verification: Array<{ type: string; domain: string; value: string; reason: string }>
  configuredBy: string | null
  misconfigured: boolean | null
  recommendedIPv4: Array<{ rank: number; value: string[] }>
  recommendedCNAME: Array<{ rank: number; value: string }>
}
export type WorkspaceDomainRecord = {
  id: string
  workspace_id: string
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
  readonly code: "INVALID_HOSTNAME" | "APEX_NOT_SUPPORTED" | "ENTITLEMENT" | "CONFLICT" | "DOMAIN_ALREADY_OWNED" | "DOMAIN_RELEASING" | "DOMAIN_MAPPING_CONFLICT" | "NOT_FOUND" | "PROVIDER" | "CONFIGURATION"
  constructor(code: DomainServiceError["code"], message: string) { super(message); this.name = "DomainServiceError"; this.code = code }
}
const selectFields = "id, workspace_id, hostname, status, provider, provider_environment, verification_state, provider_verified, dns_configured, verified_at, last_checked_at, last_error_code, last_error_message, created_at, updated_at"
function nowIso() { return new Date().toISOString() }
function dnsInstructions(result: VercelDomainOperationResult | null): DomainDnsInstructions | null {
  if (!result) return null
  return { verification: result.domain.verification || [], configuredBy: result.dns?.configuredBy || null, misconfigured: result.dns?.misconfigured ?? null, recommendedIPv4: result.dns?.recommendedIPv4 || [], recommendedCNAME: result.dns?.recommendedCNAME || [] }
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
  return { status: verified && dnsConfigured ? "active" : "verifying", verification_state: verified ? "verified" : "pending", provider_verified: verified, dns_configured: dnsConfigured, verified_at: verified ? nowIso() : null }
}
async function activeWorkspace() {
  const membership = await getCurrentWorkspace()
  if (!membership) throw new DomainServiceError("NOT_FOUND", "No active workspace is available.")
  await requireWorkspaceRole(membership.workspace_id, ["owner", "admin"])
  return membership.workspace_id
}
async function loadDomain(workspaceId: string) {
  const { data, error } = await createServiceRoleClient().from("workspace_domains").select(selectFields).eq("workspace_id", workspaceId).maybeSingle()
  if (error) throw new DomainServiceError("PROVIDER", "Domain configuration could not be loaded.")
  return data as WorkspaceDomainRecord | null
}
async function loadByHostname(hostname: string) {
  const { data, error } = await createServiceRoleClient().from("workspace_domains").select(selectFields).eq("hostname", hostname).maybeSingle()
  if (error) throw new DomainServiceError("PROVIDER", "Domain configuration could not be checked.")
  return data as WorkspaceDomainRecord | null
}
async function instructions(domain: WorkspaceDomainRecord | null) {
  if (!domain || domain.status === "removed" || !isVercelProviderConfigured()) return null
  try { return dnsInstructions(await getProjectDomain(domain.hostname)) } catch { return null }
}
async function saveProviderState(workspaceId: string, domainId: string, hostname: string, result: VercelDomainOperationResult) {
  const state = providerState(result)
  const { data, error } = await createServiceRoleClient().from("workspace_domains").update({ hostname, ...state, last_checked_at: nowIso(), last_error_code: null, last_error_message: null }).eq("id", domainId).eq("workspace_id", workspaceId).select(selectFields).single()
  if (error || !data) throw new DomainServiceError("PROVIDER", "Domain state could not be saved.")
  return { domain: data as WorkspaceDomainRecord, instructions: dnsInstructions(result) }
}

export async function getWorkspaceDomainManagementData() {
  const workspaceId = await activeWorkspace()
  const [workspace, entitlements, domain] = await Promise.all([
    createServiceRoleClient().from("workspaces").select("id, name, slug").eq("id", workspaceId).single(),
    getWorkspaceEntitlements(workspaceId), loadDomain(workspaceId),
  ])
  if (workspace.error || !workspace.data) throw new DomainServiceError("NOT_FOUND", "Workspace could not be loaded.")
  return { workspace: workspace.data, domain, instructions: await instructions(domain), customDomainEnabled: entitlements.features.customDomain, customDomainTarget: getCustomDomainTarget(), providerConfigured: isVercelProviderConfigured() }
}

export async function connectWorkspaceDomain(rawHostname: string) {
  const workspaceId = await activeWorkspace()
  if (!(await can(workspaceId, "customDomain"))) throw new DomainServiceError("ENTITLEMENT", "Custom domains are available on paid plans.")
  let hostname: string
  try { hostname = normalizeHostname(rawHostname) } catch (error) { throw new DomainServiceError("INVALID_HOSTNAME", error instanceof HostnameValidationError ? error.message : "Enter a valid hostname.") }
  const parts = getCustomerHostnameParts(hostname)
  if (!parts || parts.isApex) throw new DomainServiceError("APEX_NOT_SUPPORTED", "Custom domains support subdomains, such as app.example.com.")
  if (!isCustomDomainSetupConfigured() || !isVercelProviderConfigured()) throw new DomainServiceError("CONFIGURATION", "Custom domain management is not configured for this environment.")
  const current = await loadDomain(workspaceId)
  if (current && current.status !== "removed" && current.status !== "removing" && current.hostname !== hostname) throw new DomainServiceError("DOMAIN_MAPPING_CONFLICT", "This workspace already has another custom domain.")
  if (current?.hostname === hostname && current.status !== "removed" && current.status !== "removing") {
    try { return { ...(await saveProviderState(workspaceId, current.id, hostname, await getProjectDomain(hostname))), idempotent: true } } catch (error) { if (!(error instanceof VercelProviderError && error.code === "DOMAIN_NOT_FOUND")) return { domain: current, instructions: await instructions(current), idempotent: true } }
  }
  const existing = await loadByHostname(hostname)
  if (existing && existing.workspace_id !== workspaceId && existing.status !== "removed") throw new DomainServiceError("DOMAIN_ALREADY_OWNED", "This domain is already connected to another workspace.")
  let result: VercelDomainOperationResult
  try { result = await addProjectDomain(hostname) } catch (error) {
    if (error instanceof VercelProviderError && error.code === "DOMAIN_CONFLICT") {
      try { result = await getProjectDomain(hostname) } catch (lookupError) { throw providerError(lookupError) }
    } else throw providerError(error)
  }
  const state = providerState(result)
  const service = createServiceRoleClient()
  const query = current && current.status === "removed" ? service.from("workspace_domains").update({ hostname, ...state, last_checked_at: nowIso(), last_error_code: null, last_error_message: null }).eq("id", current.id).eq("workspace_id", workspaceId) : service.from("workspace_domains").insert({ workspace_id: workspaceId, hostname, ...state, provider: "vercel", provider_environment: "production", last_checked_at: nowIso() })
  const { data, error } = await query.select(selectFields).single()
  if (error || !data) throw new DomainServiceError("PROVIDER", "Domain mapping could not be saved.")
  return { domain: data as WorkspaceDomainRecord, instructions: dnsInstructions(result), idempotent: false }
}
export async function refreshWorkspaceDomain() {
  const workspaceId = await activeWorkspace(); const domain = await loadDomain(workspaceId)
  if (!domain || domain.status === "removed") throw new DomainServiceError("NOT_FOUND", "No custom domain is connected.")
  if (!isVercelProviderConfigured()) throw new DomainServiceError("CONFIGURATION", "Domain provider is not configured.")
  try { let result = await getProjectDomain(domain.hostname); if (!result.domain.verified) { try { result = await verifyProjectDomain(domain.hostname) } catch { /* DNS may still be propagating. */ } }; return saveProviderState(workspaceId, domain.id, domain.hostname, result) } catch (error) {
    const failure = providerError(error)
    await createServiceRoleClient().from("workspace_domains").update({ status: failure.code === "CONFIGURATION" ? domain.status : "error", verification_state: failure.code === "CONFIGURATION" ? domain.verification_state : "failed", last_checked_at: nowIso(), last_error_code: failure.code, last_error_message: failure.message }).eq("id", domain.id)
    throw failure
  }
}
export async function removeWorkspaceDomain() {
  const workspaceId = await activeWorkspace(); const domain = await loadDomain(workspaceId)
  if (!domain || domain.status === "removed") return { success: true as const }
  if (!isVercelProviderConfigured()) throw new DomainServiceError("CONFIGURATION", "Domain provider is not configured.")
  await createServiceRoleClient().from("workspace_domains").update({ status: "removing", last_checked_at: nowIso() }).eq("id", domain.id)
  try { await removeProjectDomain(domain.hostname); const { error } = await createServiceRoleClient().from("workspace_domains").delete().eq("id", domain.id); if (error) throw new Error(error.message); return { success: true as const } } catch (error) { const failure = providerError(error); await createServiceRoleClient().from("workspace_domains").update({ status: failure.code === "CONFIGURATION" ? domain.status : "error", last_checked_at: nowIso(), last_error_code: failure.code, last_error_message: failure.message }).eq("id", domain.id); throw failure }
}
export function domainErrorMessage(error: unknown) { return error instanceof DomainServiceError || error instanceof EntitlementError ? error.message : "Domain management is temporarily unavailable." }
