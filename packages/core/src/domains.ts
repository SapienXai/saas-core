/**
 * Product-neutral contracts for workspace-owned public hostname mappings.
 *
 * This package intentionally contains only portable types and validation. The
 * server-side service and database implementation stay in the Core app so a
 * consumer cannot accidentally create a second domain ownership system.
 */

export type CoreDomainType = "platform_subdomain" | "custom"

/** `error`, `removing`, and `removed` are retained for legacy provider rows. */
export type CoreDomainStatus = "pending" | "verifying" | "active" | "failed" | "error" | "removing" | "removed"

export type CorePublicSite = {
  id: string
  workspaceId: string
  productKey: string
  createdAt?: string
  updatedAt?: string
}

export type CoreDomain = {
  id: string
  workspaceId: string
  siteId: string
  hostname: string
  normalizedHostname: string
  type: CoreDomainType
  status: CoreDomainStatus
  isPrimary: boolean
  verificationToken?: string | null
  verificationMetadata?: Readonly<Record<string, unknown>>
  verifiedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type CoreHostResolution = {
  workspaceId: string
  siteId: string
  productKey: string
  domainId: string
  hostname: string
  normalizedHostname: string
  domainType: CoreDomainType
  isPrimary: boolean
  workspaceSlug?: string
  workspaceName?: string
}

export type CoreListDomainsInput = {
  workspaceId: string
  siteId: string
}

export type CorePlatformSubdomainInput = {
  workspaceId?: string
  siteId?: string
  productKey?: string
  slug: string
  rootDomain?: string
}

export type CoreDomainMutationResult = {
  site: CorePublicSite
  domain: CoreDomain
  idempotent: boolean
}

export type CoreDomainService = {
  listDomains(input: CoreListDomainsInput): Promise<readonly CoreDomain[]>
  claimPlatformSubdomain(input: CorePlatformSubdomainInput): Promise<CoreDomainMutationResult>
  changePlatformSubdomain(input: CorePlatformSubdomainInput): Promise<CoreDomainMutationResult>
  resolveHost(hostname: string): Promise<CoreHostResolution | null>
}

const CORE_PRODUCT_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/

export function isCoreProductKey(value: unknown): value is string {
  return typeof value === "string" && CORE_PRODUCT_KEY_PATTERN.test(value)
}
