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

export type DomainReconcileResult = {
  providerDomainId: string | null
  status: "pending" | "active" | "error"
  verificationState: "pending" | "verified" | "failed"
  dnsConfigured: boolean
  sslState: "pending" | "provisioned" | "failed"
  lastError: string | null
}

export async function reconcileDomainState(provider: DomainProvider, domain: { hostname: string; providerDomainId: string | null }): Promise<DomainReconcileResult> {
  try {
    const state = await reconcileDomain(provider, domain)
    return { providerDomainId: state.providerDomainId, status: state.status, verificationState: state.verified ? "verified" : "pending", dnsConfigured: state.dnsConfigured, sslState: state.sslState, lastError: null }
  } catch (error) {
    return { providerDomainId: domain.providerDomainId, status: "error", verificationState: "failed", dnsConfigured: false, sslState: "failed", lastError: error instanceof Error ? error.message : "Domain provider failed." }
  }
}

export class VercelDomainProvider implements DomainProvider {
  constructor(private readonly input: { token: string; projectId: string; teamId?: string; fetcher?: typeof fetch }) {}
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const fetcher = this.input.fetcher ?? fetch
    const team = this.input.teamId ? `?teamId=${encodeURIComponent(this.input.teamId)}` : ""
    const separator = path.includes("?") ? "&" : team ? "?" : ""
    const response = await fetcher(`https://api.vercel.com${path}${separator}${team.replace(/^\?/, "")}`, { ...init, headers: { Authorization: `Bearer ${this.input.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } })
    if (!response.ok) throw new Error(`Vercel domain request failed (${response.status}).`)
    return response.json() as Promise<T>
  }
  async add(input: { hostname: string }) { const result = await this.request<{ uid?: string; name?: string }>(`/v10/projects/${encodeURIComponent(this.input.projectId)}/domains`, { method: "POST", body: JSON.stringify({ name: input.hostname }) }); return { providerDomainId: result.uid ?? result.name ?? input.hostname } }
  async verify(input: { providerDomainId: string }) { const result = await this.request<{ verified?: boolean; misconfigured?: boolean; verification?: unknown }>(`/v9/projects/${encodeURIComponent(this.input.projectId)}/domains/${encodeURIComponent(input.providerDomainId)}`); const verified = result.verified === true && result.misconfigured !== true; return { verified, dnsConfigured: verified, sslState: verified ? "provisioned" as const : "pending" as const } }
  async remove(input: { providerDomainId: string }) { await this.request(`/v9/projects/${encodeURIComponent(this.input.projectId)}/domains/${encodeURIComponent(input.providerDomainId)}`, { method: "DELETE" }) }
}
