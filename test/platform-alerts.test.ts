import { describe, expect, it } from "vitest"
import { deriveDomainAlerts, deriveWorkspaceAlerts, deriveWebhookAlerts } from "@/lib/platform-alerts"

const now = new Date("2026-08-12T12:00:00.000Z")

describe("platform alerts", () => {
  it("surfaces quota, billing, suspension, and expiring override signals with severity", () => {
    const alerts = deriveWorkspaceAlerts([
      { id: "workspace-1", name: "Felix Hospitality", slug: "felix", platformStatus: "suspended", subscriptionStatus: "active", reservationUsage: 100, reservationLimit: 100, overrideId: "override-1", overrideEffectiveUntil: "2026-08-15T12:00:00.000Z" },
      { id: "workspace-2", name: "Unknown Billing", slug: "unknown", platformStatus: "active", subscriptionStatus: null, reservationUsage: 0, reservationLimit: null },
    ], now)

    expect(alerts.map((alert) => alert.id)).toEqual(expect.arrayContaining(["suspension:workspace-1", "quota-limit:workspace-1", "override-expiring:override-1", "billing-unknown:workspace-2"]))
    expect(alerts.find((alert) => alert.id === "quota-limit:workspace-1")?.severity).toBe("critical")
    expect(alerts.find((alert) => alert.id === "override-expiring:override-1")?.severity).toBe("warning")
  })

  it("does not turn unknown provider state into a green signal", () => {
    const alerts = deriveDomainAlerts([{ id: "domain-1", hostname: "reserve.example.com", restaurantId: "restaurant-1", restaurantName: "Example", workspaceId: "workspace-1", workspaceName: "Example workspace", status: "active", verificationState: "unknown", providerVerified: false, dnsConfigured: false }], now)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe("warning")
    expect(alerts[0].title).toMatch(/unknown/i)
  })

  it("links failed provider reconciliation to billing operations", () => {
    const alerts = deriveWebhookAlerts([{ id: "event-1", eventType: "subscription.updated", workspaceId: "workspace-1", workspaceName: "Felix Hospitality", receivedAt: now.toISOString() }])
    expect(alerts[0]).toMatchObject({ type: "reconciliation", severity: "critical", href: "/platform/workspaces/workspace-1?tab=billing" })
  })
})
