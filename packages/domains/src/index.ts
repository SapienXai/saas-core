export { assertDomainAvailable, createDomainRecord, getDomainStatus } from "@sapienx/saas-core"
export { normalizeHostname, hostnameParts } from "@sapienx/saas-core"
export type { DomainRecord } from "@sapienx/saas-core"

export type DomainProvider = {
  add(input: { hostname: string }): Promise<{ providerDomainId: string }>
  verify(input: { providerDomainId: string }): Promise<{ verified: boolean; dnsConfigured: boolean; sslState: "pending" | "provisioned" | "failed" }>
  remove(input: { providerDomainId: string }): Promise<void>
}

export async function reconcileDomain(provider: DomainProvider, domain: { hostname: string; providerDomainId: string | null }) {
  const providerDomainId = domain.providerDomainId ?? (await provider.add({ hostname: domain.hostname })).providerDomainId
  const state = await provider.verify({ providerDomainId })
  return { providerDomainId, ...state, status: state.verified && state.dnsConfigured && state.sslState === "provisioned" ? "active" as const : "pending" as const }
}
