import { describe, expect, it } from "vitest"
import { getDomainStatus } from "../lib/domains/domain-state"

const domain = {
  status: "verifying",
  verification_state: "pending",
  provider_verified: false,
  dns_configured: false,
}

describe("custom domain status", () => {
  it("distinguishes a live domain from a DNS-pending domain", () => {
    expect(getDomainStatus({ ...domain, status: "active", provider_verified: true, dns_configured: true }, true, { misconfigured: false })).toBe("connected")
    expect(getDomainStatus(domain, true, { misconfigured: false })).toBe("pending")
  })

  it("marks provider failures and incorrect DNS separately", () => {
    expect(getDomainStatus({ ...domain, status: "error", verification_state: "failed" }, true, { misconfigured: false })).toBe("failed")
    expect(getDomainStatus(domain, true, { misconfigured: true })).toBe("invalid")
  })

  it("keeps a connected domain visibly paused when its plan no longer includes it", () => {
    expect(getDomainStatus({ ...domain, status: "active", provider_verified: true, dns_configured: true }, false, { misconfigured: false })).toBe("suspended")
  })
})
