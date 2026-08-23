import { CoreError } from "./errors.js"
import { normalizeHostname } from "./normalize.js"
import type { DomainRecord } from "./types.js"

export function createDomainRecord(input: { id: string; workspaceId: string; hostname: string; rootDomain?: string; appDomain?: string }): DomainRecord {
  const hostnameOptions = {
    ...(input.rootDomain ? { rootDomain: input.rootDomain } : {}),
    ...(input.appDomain ? { appDomain: input.appDomain } : {}),
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    hostname: normalizeHostname(input.hostname, hostnameOptions),
    status: "pending",
    verificationState: "pending",
    dnsConfigured: false,
    sslState: "pending",
    providerDomainId: null,
    lastCheckedAt: null,
    lastError: null,
  }
}

export function getDomainStatus(domain: DomainRecord | null, enabled: boolean): "not-connected" | "pending" | "connected" | "failed" | "suspended" {
  if (!domain) return "not-connected"
  if (!enabled && domain.status === "active") return "suspended"
  if (domain.status === "active" && domain.verificationState === "verified" && domain.dnsConfigured && domain.sslState === "provisioned") return "connected"
  if (domain.status === "error" || domain.verificationState === "failed" || domain.sslState === "failed") return "failed"
  return "pending"
}

export function assertDomainAvailable(domains: Iterable<DomainRecord>, hostname: string): string {
  const normalized = normalizeHostname(hostname)
  if ([...domains].some((domain) => domain.hostname === normalized)) throw new CoreError("CONFLICT", "That hostname is already connected.", { hostname: normalized })
  return normalized
}
