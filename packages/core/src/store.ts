import { CoreError } from "./errors.js"
import { createAuditEvent } from "./audit.js"
import { resolveEntitlements } from "./entitlements.js"
import { createInvitationRecord, validateInvitation } from "./invitations.js"
import { normalizeEmail, normalizeSlug } from "./normalize.js"
import { canManageWorkspaceRole, requireWorkspacePermission } from "./permissions.js"
import { consumeUsage, createOrGetUsagePeriod, remainingUsage, usageKey } from "./usage.js"
import type { CoreState, Entitlements, Invitation, Membership, Plan, Subscription, SubscriptionOverride, UsagePeriod, User, Workspace, WorkspaceRole } from "./types.js"

const now = () => new Date().toISOString()
let sequence = 0
const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(++sequence).toString(36)}`

export const DEFAULT_PLANS: Plan[] = [
  { key: "free", name: "Free", active: true, billing: { currency: "USD", monthlyPriceCents: 0 }, features: { core: true, customDomain: false, customPWA: false, pushNotifications: false }, limits: { users: 1, projects: 1, api_calls: 1000 } },
  { key: "starter", name: "Starter", active: true, billing: { currency: "USD", monthlyPriceCents: 1900, yearlyPriceCents: 19000 }, features: { core: true, customDomain: false, customPWA: false, pushNotifications: false }, limits: { users: 3, projects: 5, api_calls: 10000 } },
  { key: "pro", name: "Pro", active: true, billing: { currency: "USD", monthlyPriceCents: 4900, yearlyPriceCents: 49000 }, features: { core: true, customDomain: true, customPWA: true, pushNotifications: true }, limits: { users: 10, projects: 50, api_calls: 100000 } },
  { key: "business", name: "Business", active: true, billing: { currency: "USD", monthlyPriceCents: 9900, yearlyPriceCents: 99000 }, features: { core: true, customDomain: true, customPWA: true, pushNotifications: true, auditExports: true }, limits: { users: 25, projects: null, api_calls: null } },
]

export class InMemorySaaSStore {
  readonly state: CoreState

  constructor(plans: Plan[] = DEFAULT_PLANS) {
    this.state = { users: new Map(), workspaces: new Map(), memberships: new Map(), invitations: new Map(), plans: new Map(plans.map((plan) => [plan.key, structuredClone(plan)])), subscriptions: new Map(), overrides: new Map(), usage: new Map(), audits: [], platformMembers: new Map(), domains: new Map() }
  }

  addUser(input: { id?: string; email: string }): User {
    const user: User = { id: input.id ?? id("usr"), email: normalizeEmail(input.email), createdAt: now() }
    this.state.users.set(user.id, user)
    return user
  }

  createWorkspace(input: { ownerUserId: string; name: string; slug: string }): { workspace: Workspace; membership: Membership } {
    if (!this.state.users.has(input.ownerUserId)) throw new CoreError("NOT_FOUND", "Owner user was not found.")
    const slug = normalizeSlug(input.slug)
    if ([...this.state.workspaces.values()].some((workspace) => workspace.slug === slug)) throw new CoreError("CONFLICT", "That workspace slug is already in use.")
    const workspace: Workspace = { id: id("wsp"), name: input.name.trim(), slug, status: "active", createdBy: input.ownerUserId, preferredTimezone: "UTC", onboardingCompletedAt: null, createdAt: now() }
    const membership: Membership = { id: id("mem"), workspaceId: workspace.id, userId: input.ownerUserId, role: "owner", status: "active", createdAt: now(), updatedAt: now() }
    this.state.workspaces.set(workspace.id, workspace)
    this.state.memberships.set(membership.id, membership)
    const subscription: Subscription = { workspaceId: workspace.id, planKey: "free", status: "active", source: "free", provider: null, providerEnvironment: null, providerCustomerId: null, providerSubscriptionId: null, currentPeriodStart: null, currentPeriodEnd: null, scheduledPlanKey: null, scheduledPlanAt: null, paymentFailureStartedAt: null, paymentGraceEndsAt: null, billingIssueCode: null, lastProviderEventAt: null, lastProviderEventId: null }
    this.state.subscriptions.set(workspace.id, subscription)
    this.writeAudit({ actorUserId: input.ownerUserId, action: "workspace.created", entityType: "workspace", entityId: workspace.id, after: { slug, name: workspace.name } })
    return { workspace, membership }
  }

  membershipsForWorkspace(workspaceId: string): Membership[] { return [...this.state.memberships.values()].filter((membership) => membership.workspaceId === workspaceId) }
  membership(workspaceId: string, userId: string): Membership | null { return this.membershipsForWorkspace(workspaceId).find((membership) => membership.userId === userId && membership.status === "active") ?? null }

  getEntitlements(workspaceId: string, at = new Date()): Entitlements {
    const subscription = this.state.subscriptions.get(workspaceId)
    if (!subscription) throw new CoreError("NOT_FOUND", "Workspace subscription was not found.")
    const atDate = at instanceof Date ? at : new Date(at)
    const override = [...this.state.overrides.values()]
      .filter((entry) => entry.workspaceId === workspaceId && !entry.revokedAt && new Date(entry.effectiveFrom) <= atDate && (!entry.effectiveUntil || new Date(entry.effectiveUntil) > atDate))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
    return resolveEntitlements({ workspaceId, plans: this.state.plans.values(), subscription, override, now: atDate })
  }

  requireMember(workspaceId: string, userId: string, permission: Parameters<typeof requireWorkspacePermission>[1]): Membership {
    const membership = this.membership(workspaceId, userId)
    if (!membership) throw new CoreError("FORBIDDEN", "You do not have access to this workspace.")
    requireWorkspacePermission(membership.role, permission)
    return membership
  }

  invite(input: { actorUserId: string; workspaceId: string; email: string; role: WorkspaceRole; expiresAt?: string }): { invitation: Invitation; token: string } {
    const actor = this.requireMember(input.workspaceId, input.actorUserId, "members:invite")
    if (!canManageWorkspaceRole(actor.role, input.role)) throw new CoreError("FORBIDDEN", "This role cannot be assigned by the current member.")
    const entitlements = this.getEntitlements(input.workspaceId)
    const seatLimit = entitlements.limits.users ?? null
    const activeMembers = this.membershipsForWorkspace(input.workspaceId).filter((member) => member.status === "active").length
    const pending = [...this.state.invitations.values()].filter((entry) => entry.workspaceId === input.workspaceId && entry.status === "pending" && new Date(entry.expiresAt) > new Date()).length
    if (seatLimit !== null && activeMembers + pending + 1 > seatLimit) throw new CoreError("LIMIT_REACHED", "The workspace seat limit has been reached.", { metric: "users", limit: seatLimit })
    const result = createInvitationRecord({ id: id("inv"), workspaceId: input.workspaceId, email: input.email, role: input.role, invitedBy: input.actorUserId, expiresAt: input.expiresAt ?? new Date(Date.now() + 7 * 86400000).toISOString() })
    this.state.invitations.set(result.record.id, result.record)
    this.writeAudit({ actorUserId: input.actorUserId, action: "invitation.created", entityType: "invitation", entityId: result.record.id, after: { email: result.record.normalizedEmail, role: result.record.role } })
    return { invitation: result.record, token: result.token }
  }

  acceptInvitation(input: { token: string; userId: string }): Membership {
    const user = this.state.users.get(input.userId)
    if (!user) throw new CoreError("NOT_FOUND", "User was not found.")
    const matched = [...this.state.invitations.values()].find((entry) => {
      try { validateInvitation({ invitation: entry, token: input.token, email: user.email }); return true } catch { return false }
    })
    if (!matched) throw new CoreError("INVITATION_INVALID", "This invitation is no longer valid.")
    const existing = this.membership(matched.workspaceId, user.id)
    if (existing) { matched.status = "accepted"; matched.acceptedAt = now(); return existing }
    const membership: Membership = { id: id("mem"), workspaceId: matched.workspaceId, userId: user.id, role: matched.role, status: "active", createdAt: now(), updatedAt: now() }
    this.state.memberships.set(membership.id, membership)
    matched.status = "accepted"
    matched.acceptedAt = now()
    this.writeAudit({ actorUserId: user.id, action: "invitation.accepted", entityType: "invitation", entityId: matched.id, after: { membershipId: membership.id } })
    return membership
  }

  incrementUsage(input: { workspaceId: string; metric: string; amount?: number; now?: Date }): { period: UsagePeriod; remaining: number | null } {
    const entitlements = this.getEntitlements(input.workspaceId, input.now)
    const calendar = createOrGetUsagePeriod({ workspaceId: input.workspaceId, metric: input.metric, ...(input.now ? { now: input.now } : {}) })
    const period = createOrGetUsagePeriod({ workspaceId: input.workspaceId, metric: input.metric, ...(input.now ? { now: input.now } : {}), existing: this.state.usage.get(usageKey(input.workspaceId, input.metric, calendar.periodStart)) ?? null })
    const updated = consumeUsage({ entitlements, period, ...(input.amount !== undefined ? { amount: input.amount } : {}), ...(input.now ? { now: input.now } : {}) })
    this.state.usage.set(usageKey(updated.workspaceId, updated.metric, updated.periodStart), updated)
    return { period: updated, remaining: remainingUsage(entitlements, updated) }
  }

  setSubscription(workspaceId: string, patch: Partial<Subscription>, actorUserId: string | null = null): Subscription {
    const current = this.state.subscriptions.get(workspaceId)
    if (!current) throw new CoreError("NOT_FOUND", "Workspace subscription was not found.")
    const updated = { ...current, ...patch, workspaceId }
    this.state.subscriptions.set(workspaceId, updated)
    this.writeAudit({ actorUserId, action: "subscription.updated", entityType: "subscription", entityId: workspaceId, before: { planKey: current.planKey, status: current.status }, after: { planKey: updated.planKey, status: updated.status } })
    return updated
  }

  addOverride(input: Omit<SubscriptionOverride, "id" | "revokedAt"> & { id?: string }): SubscriptionOverride {
    const override: SubscriptionOverride = { ...input, id: input.id ?? id("ovr"), revokedAt: null }
    this.state.overrides.set(override.id, override)
    this.writeAudit({ actorUserId: input.actorUserId, action: "subscription.override.created", entityType: "subscription_override", entityId: override.id, reason: input.reason, after: { planKey: override.planKey, workspaceId: override.workspaceId } })
    return override
  }

  writeAudit(input: Omit<Parameters<typeof createAuditEvent>[0], "id">): void { this.state.audits.push(createAuditEvent({ ...input, id: id("aud") })) }
}
