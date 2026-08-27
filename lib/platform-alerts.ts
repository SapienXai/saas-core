export type PlatformAlertSeverity = "critical" | "warning" | "info"
export type PlatformAlertType = "billing" | "quota" | "domain" | "suspension" | "override" | "reconciliation"
export type PlatformAlertEntity = "workspace" | "restaurant" | "domain" | "platform"

export type PlatformAlert = {
  id: string
  type: PlatformAlertType
  severity: PlatformAlertSeverity
  entityType: PlatformAlertEntity
  entityId: string | null
  entityLabel: string
  title: string
  message: string
  detectedAt: string
  href: string
}

export type WorkspaceAlertSnapshot = {
  id: string
  name: string
  slug: string
  platformStatus: string
  subscriptionStatus: string | null
  providerStatus?: string | null
  billingIssueCode?: string | null
  reservationUsage?: number | null
  reservationLimit?: number | null
  overrideId?: string | null
  overrideEffectiveUntil?: string | null
}

export type DomainAlertSnapshot = {
  id: string
  hostname: string
  restaurantId: string
  restaurantName: string
  workspaceId: string | null
  workspaceName: string | null
  status: string
  verificationState: string
  providerVerified: boolean
  dnsConfigured: boolean
  lastCheckedAt?: string | null
  lastErrorCode?: string | null
}

export type WebhookAlertSnapshot = {
  id: string
  eventType: string
  workspaceId: string | null
  workspaceName: string | null
  receivedAt: string
}

const severityRank: Record<PlatformAlertSeverity, number> = { critical: 0, warning: 1, info: 2 }

function workspaceHref(id: string) {
  return `/platform/workspaces/${id}`
}

function billingMismatch(snapshot: WorkspaceAlertSnapshot) {
  return Boolean(snapshot.providerStatus && snapshot.subscriptionStatus && snapshot.providerStatus !== snapshot.subscriptionStatus)
}

export function deriveWorkspaceAlerts(snapshots: WorkspaceAlertSnapshot[], now = new Date()): PlatformAlert[] {
  const alerts: PlatformAlert[] = []
  const nowTime = now.getTime()
  const horizon = nowTime + 7 * 86400000

  for (const snapshot of snapshots) {
    const href = workspaceHref(snapshot.id)
    if (snapshot.platformStatus === "suspended") {
      alerts.push({ id: `suspension:${snapshot.id}`, type: "suspension", severity: "critical", entityType: "workspace", entityId: snapshot.id, entityLabel: snapshot.name, title: "Workspace suspended", message: `${snapshot.name} is currently suspended and cannot operate normally.`, detectedAt: now.toISOString(), href })
    }

    if (billingMismatch(snapshot)) {
      alerts.push({ id: `billing-mismatch:${snapshot.id}`, type: "billing", severity: "critical", entityType: "workspace", entityId: snapshot.id, entityLabel: snapshot.name, title: "Billing state mismatch", message: `Local billing is ${snapshot.subscriptionStatus}, while the provider reports ${snapshot.providerStatus}.`, detectedAt: now.toISOString(), href: `${href}?tab=billing` })
    } else if (snapshot.subscriptionStatus === "past_due") {
      alerts.push({ id: `billing-past-due:${snapshot.id}`, type: "billing", severity: "critical", entityType: "workspace", entityId: snapshot.id, entityLabel: snapshot.name, title: "Billing needs attention", message: `${snapshot.name} has a past-due subscription${snapshot.billingIssueCode ? ` (${snapshot.billingIssueCode})` : ""}.`, detectedAt: now.toISOString(), href: `${href}?tab=billing` })
    } else if (!snapshot.subscriptionStatus || snapshot.subscriptionStatus === "unknown") {
      alerts.push({ id: `billing-unknown:${snapshot.id}`, type: "billing", severity: "warning", entityType: "workspace", entityId: snapshot.id, entityLabel: snapshot.name, title: "Billing state unknown", message: `No reliable subscription state is available for ${snapshot.name}.`, detectedAt: now.toISOString(), href: `${href}?tab=billing` })
    }

    if (snapshot.reservationLimit !== null && snapshot.reservationLimit !== undefined && snapshot.reservationLimit > 0) {
      const usage = Math.max(0, snapshot.reservationUsage || 0)
      const ratio = usage / snapshot.reservationLimit
      if (ratio >= 1) alerts.push({ id: `quota-limit:${snapshot.id}`, type: "quota", severity: "critical", entityType: "workspace", entityId: snapshot.id, entityLabel: snapshot.name, title: "Reservation limit reached", message: `${usage.toLocaleString()} of ${snapshot.reservationLimit.toLocaleString()} reservations used this period.`, detectedAt: now.toISOString(), href })
      else if (ratio >= 0.9) alerts.push({ id: `quota-warning:${snapshot.id}`, type: "quota", severity: "warning", entityType: "workspace", entityId: snapshot.id, entityLabel: snapshot.name, title: "Reservation quota above 90%", message: `${usage.toLocaleString()} of ${snapshot.reservationLimit.toLocaleString()} reservations used this period.`, detectedAt: now.toISOString(), href })
    }

    if (snapshot.overrideId && snapshot.overrideEffectiveUntil) {
      const expiresAt = new Date(snapshot.overrideEffectiveUntil).getTime()
      if (Number.isFinite(expiresAt) && expiresAt >= nowTime && expiresAt <= horizon) alerts.push({ id: `override-expiring:${snapshot.overrideId}`, type: "override", severity: "warning", entityType: "workspace", entityId: snapshot.id, entityLabel: snapshot.name, title: "Entitlement override expires soon", message: `The active entitlement override expires ${new Date(expiresAt).toLocaleDateString()}.`, detectedAt: now.toISOString(), href: `${href}?tab=billing` })
    }
  }
  return alerts
}

export function deriveDomainAlerts(snapshots: DomainAlertSnapshot[], now = new Date()): PlatformAlert[] {
  const alerts: PlatformAlert[] = []
  for (const snapshot of snapshots) {
    const href = snapshot.workspaceId ? `/platform/workspaces/${snapshot.workspaceId}` : `/platform/domains?domain=${encodeURIComponent(snapshot.hostname)}`
    const label = snapshot.workspaceName ? `${snapshot.hostname} · ${snapshot.workspaceName}` : snapshot.hostname
    if (snapshot.status === "error" || snapshot.status === "suspended" || snapshot.verificationState === "failed") alerts.push({ id: `domain-error:${snapshot.id}`, type: "domain", severity: "critical", entityType: "domain", entityId: snapshot.id, entityLabel: label, title: "Custom domain has a problem", message: `${snapshot.hostname} is not routing cleanly${snapshot.lastErrorCode ? ` (${snapshot.lastErrorCode})` : ""}.`, detectedAt: snapshot.lastCheckedAt || now.toISOString(), href })
    else if (snapshot.status === "pending" || snapshot.status === "verifying" || snapshot.verificationState === "pending") alerts.push({ id: `domain-pending:${snapshot.id}`, type: "domain", severity: "warning", entityType: "domain", entityId: snapshot.id, entityLabel: label, title: "Custom domain is pending", message: `${snapshot.hostname} still needs verification or routing confirmation.`, detectedAt: snapshot.lastCheckedAt || now.toISOString(), href })
    else if (snapshot.status === "active" && (!snapshot.providerVerified || !snapshot.dnsConfigured || snapshot.verificationState === "unknown")) alerts.push({ id: `domain-unknown:${snapshot.id}`, type: "domain", severity: "warning", entityType: "domain", entityId: snapshot.id, entityLabel: label, title: "Domain readiness is unknown", message: `${snapshot.hostname} is marked active locally, but provider readiness is incomplete.`, detectedAt: snapshot.lastCheckedAt || now.toISOString(), href })
  }
  return alerts
}

export function deriveWebhookAlerts(snapshots: WebhookAlertSnapshot[]): PlatformAlert[] {
  return snapshots.map((snapshot) => ({ id: `webhook:${snapshot.id}`, type: "reconciliation", severity: "critical", entityType: snapshot.workspaceId ? "workspace" : "platform", entityId: snapshot.workspaceId, entityLabel: snapshot.workspaceName || "Paddle", title: "Paddle webhook failed", message: `${snapshot.eventType} could not be reconciled and needs review.`, detectedAt: snapshot.receivedAt, href: snapshot.workspaceId ? `${workspaceHref(snapshot.workspaceId)}?tab=billing` : "/platform/billing" }))
}

export function sortPlatformAlerts(alerts: PlatformAlert[]) {
  return [...alerts].sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
}
