export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type WorkspaceStatus = "active" | "suspended" | "archived"
export type MembershipStatus = "active" | "suspended"
export type WorkspaceRole = "owner" | "admin" | "manager" | "member" | "viewer"
export type PlatformRole = "platform_owner" | "platform_admin" | "billing_admin" | "support" | "auditor"
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "paused" | "canceled"
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired"
export type DeliveryStatus = "pending" | "sent" | "failed"

export type FeatureDefinition = {
  key: string
  description?: string
}

export type MetricDefinition = {
  key: string
  description?: string
  period: "calendar_month" | "subscription_period" | "rolling"
}

export type Plan = {
  key: string
  name: string
  active: boolean
  billing: {
    currency: string
    monthlyPriceCents: number
    yearlyPriceCents?: number | null
    providerProductId?: string | null
  }
  features: Record<string, boolean>
  limits: Record<string, number | null>
  metadata?: Record<string, Json>
}

export type User = {
  id: string
  email: string
  createdAt: string
}

export type Workspace = {
  id: string
  name: string
  slug: string
  status: WorkspaceStatus
  createdBy: string
  preferredTimezone: string
  onboardingCompletedAt: string | null
  createdAt: string
}

export type Membership = {
  id: string
  workspaceId: string
  userId: string
  role: WorkspaceRole
  status: MembershipStatus
  createdAt: string
  updatedAt: string
}

export type Invitation = {
  id: string
  workspaceId: string
  normalizedEmail: string
  role: WorkspaceRole
  tokenHash: string
  status: InvitationStatus
  invitedBy: string
  expiresAt: string
  emailDeliveryStatus: DeliveryStatus
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export type Subscription = {
  workspaceId: string
  planKey: string
  status: SubscriptionStatus
  source: "free" | "manual" | "system" | "paddle"
  provider: "paddle" | null
  providerEnvironment: "sandbox" | "live" | null
  providerCustomerId: string | null
  providerSubscriptionId: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  scheduledPlanKey: string | null
  scheduledPlanAt: string | null
  paymentFailureStartedAt: string | null
  paymentGraceEndsAt: string | null
  billingIssueCode: string | null
  lastProviderEventAt: string | null
  lastProviderEventId: string | null
}

export type SubscriptionOverride = {
  id: string
  workspaceId: string
  planKey: string
  reason: string
  actorUserId: string
  effectiveFrom: string
  effectiveUntil: string | null
  revokedAt: string | null
}

export type UsagePeriod = {
  workspaceId: string
  metric: string
  periodStart: string
  periodEnd: string
  amount: number
  updatedAt: string
}

export type AuditEvent = {
  id: string
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string | null
  before: Record<string, Json>
  after: Record<string, Json>
  reason: string | null
  metadata: Record<string, Json>
  createdAt: string
}

export type PlatformMember = {
  userId: string
  role: PlatformRole
  status: "active" | "suspended"
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type DomainRecord = {
  id: string
  workspaceId: string
  hostname: string
  status: "pending" | "verified" | "active" | "error" | "suspended"
  verificationState: "pending" | "verified" | "failed"
  dnsConfigured: boolean
  sslState: "pending" | "provisioned" | "failed"
  providerDomainId: string | null
  lastCheckedAt: string | null
  lastError: string | null
}

export type Entitlements = {
  workspaceId: string
  planKey: string
  planName: string
  features: Record<string, boolean>
  limits: Record<string, number | null>
  subscription: Subscription
  overrideId: string | null
  scheduledPlan: { key: string; effectiveAt: string } | null
}

export type CoreState = {
  users: Map<string, User>
  workspaces: Map<string, Workspace>
  memberships: Map<string, Membership>
  invitations: Map<string, Invitation>
  plans: Map<string, Plan>
  subscriptions: Map<string, Subscription>
  overrides: Map<string, SubscriptionOverride>
  usage: Map<string, UsagePeriod>
  audits: AuditEvent[]
  platformMembers: Map<string, PlatformMember>
  domains: Map<string, DomainRecord>
}
