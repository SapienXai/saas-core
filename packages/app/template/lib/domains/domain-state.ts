export type DomainStatus = "connected" | "pending" | "invalid" | "failed" | "suspended" | "not-connected"

type DomainStateRecord = {
  status: string
  verification_state: string
  provider_verified: boolean
  dns_configured: boolean
}

type DomainInstructionsState = {
  misconfigured: boolean | null
} | null

export function getDomainStatus(
  domain: DomainStateRecord | null,
  customDomainEnabled: boolean,
  instructions: DomainInstructionsState,
): DomainStatus {
  if (!domain) return "not-connected"
  if (!customDomainEnabled && domain.status === "active") return "suspended"
  if (domain.status === "active" && domain.provider_verified && domain.dns_configured) return "connected"
  if (domain.status === "error" || domain.verification_state === "failed") return "failed"
  if (domain.verification_state === "invalid" || instructions?.misconfigured === true) return "invalid"
  return "pending"
}
