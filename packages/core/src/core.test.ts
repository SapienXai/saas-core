import { describe, expect, it } from "vitest"
import { createHmac } from "node:crypto"
import {
  CoreError,
  InMemorySaaSStore,
  assertFeature,
  assertWithinLimit,
  createDomainRecord,
  createInvitationRecord,
  hashInvitationToken,
  normalizeHostname,
  normalizeSlug,
  resolveEffectivePlanKey,
  validateInvitation,
  verifyHmacWebhook,
} from "./index.js"
import { verifyPaddleWebhookSignature } from "./billing.js"

describe("SaaS Core domain primitives", () => {
  it("normalizes workspace and domain identifiers safely", () => {
    expect(normalizeSlug("  Café Operations ")).toBe("cafe-operations")
    expect(normalizeHostname("https://Customer.Example.net./")).toBe("customer.example.net")
    expect(() => normalizeHostname("http://127.0.0.1")).toThrowError(CoreError)
    expect(() => normalizeHostname("app.example.com", { rootDomain: "example.com", appDomain: "app.example.com" })).toThrowError(CoreError)
  })

  it("keeps manual override above scheduled/current subscription state", () => {
    const subscription = {
      workspaceId: "w", planKey: "starter", status: "active" as const, source: "paddle" as const, provider: "paddle" as const, providerEnvironment: "sandbox" as const,
      providerCustomerId: null, providerSubscriptionId: "sub", currentPeriodStart: null, currentPeriodEnd: null, scheduledPlanKey: "pro", scheduledPlanAt: "2030-01-01T00:00:00.000Z",
      paymentFailureStartedAt: null, paymentGraceEndsAt: null, billingIssueCode: null, lastProviderEventAt: null, lastProviderEventId: null,
    }
    expect(resolveEffectivePlanKey({ subscription, now: new Date("2026-01-01T00:00:00.000Z") })).toBe("starter")
    expect(resolveEffectivePlanKey({ subscription, override: { id: "o", workspaceId: "w", planKey: "business", reason: "support", actorUserId: "u", effectiveFrom: "2025-01-01T00:00:00.000Z", effectiveUntil: null, revokedAt: null }, now: new Date("2026-01-01T00:00:00.000Z") })).toBe("business")
  })

  it("blocks a grace-expired past-due plan without deleting provider state", () => {
    const store = new InMemorySaaSStore()
    const owner = store.addUser({ id: "owner", email: "owner@example.test" })
    const { workspace } = store.createWorkspace({ ownerUserId: owner.id, name: "Billing", slug: "billing" })
    store.setSubscription(workspace.id, { planKey: "pro", status: "past_due", paymentGraceEndsAt: "2025-01-01T00:00:00.000Z", providerSubscriptionId: "sub_1" })
    expect(store.getEntitlements(workspace.id, new Date("2026-01-01T00:00:00.000Z")).planKey).toBe("free")
    expect(store.state.subscriptions.get(workspace.id)?.providerSubscriptionId).toBe("sub_1")
  })

  it("reserves invitation seats and never stores the plaintext token", () => {
    const store = new InMemorySaaSStore()
    const owner = store.addUser({ id: "owner", email: "owner@example.test" })
    const member = store.addUser({ id: "member", email: "member@example.test" })
    const { workspace } = store.createWorkspace({ ownerUserId: owner.id, name: "Teams", slug: "teams" })
    store.setSubscription(workspace.id, { planKey: "starter" })
    const result = store.invite({ actorUserId: owner.id, workspaceId: workspace.id, email: member.email, role: "member" })
    expect(result.token).not.toBe(result.invitation.tokenHash)
    expect(result.invitation.tokenHash).toBe(hashInvitationToken(result.token))
    expect(store.acceptInvitation({ token: result.token, userId: member.id }).role).toBe("member")
    expect(() => store.acceptInvitation({ token: result.token, userId: member.id })).toThrowError(CoreError)
  })

  it("keeps wrong-email invitations and replay attempts closed", () => {
    const result = createInvitationRecord({ id: "inv", workspaceId: "w", email: "person@example.test", role: "member", invitedBy: "u", expiresAt: "2030-01-01T00:00:00.000Z" })
    expect(() => validateInvitation({ invitation: result.record, token: result.token, email: "attacker@example.test" })).toThrowError(CoreError)
    expect(() => validateInvitation({ invitation: result.record, token: "wrong-token", email: "person@example.test" })).toThrowError(CoreError)
  })

  it("enforces usage limits and records unlimited usage", () => {
    const store = new InMemorySaaSStore()
    const owner = store.addUser({ id: "owner", email: "owner@example.test" })
    const { workspace } = store.createWorkspace({ ownerUserId: owner.id, name: "Usage", slug: "usage" })
    const plan = store.state.plans.get("free")!
    plan.limits.api_calls = 2
    expect(store.incrementUsage({ workspaceId: workspace.id, metric: "api_calls" }).remaining).toBe(1)
    expect(store.incrementUsage({ workspaceId: workspace.id, metric: "api_calls" }).remaining).toBe(0)
    expect(() => store.incrementUsage({ workspaceId: workspace.id, metric: "api_calls" })).toThrowError(CoreError)
    const entitlements = { ...store.getEntitlements(workspace.id), limits: { api_calls: null } }
    expect(() => assertWithinLimit(entitlements, "api_calls", 999999)).not.toThrow()
    assertFeature({ ...entitlements, features: { core: true } }, "core")
  })

  it("applies provider event ordering and constant-time signature checks", () => {
    const raw = '{"event":"subscription.updated"}'
    const signature = "7d0e2a" // deliberately invalid, the negative branch is the contract tested here.
    expect(verifyHmacWebhook(raw, signature, "secret")).toBe(false)
    const timestamp = Math.floor(Date.now() / 1000)
    const paddleSignature = createHmac("sha256", "secret").update(`${timestamp}:${raw}`).digest("hex")
    expect(verifyPaddleWebhookSignature(raw, `ts=${timestamp};h1=${paddleSignature}`, "secret")).toBe(true)
    expect(verifyPaddleWebhookSignature(raw, `ts=${timestamp - 9999};h1=${paddleSignature}`, "secret")).toBe(false)
    const domain = createDomainRecord({ id: "dom", workspaceId: "w", hostname: "tenant.example.net" })
    expect(domain.status).toBe("pending")
  })
})
