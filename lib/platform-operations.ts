import "server-only"

import { isPaddleBillingConfigured } from "@/lib/billing/paddle-client"
import { isVercelProviderConfigured, getProjectDomain, verifyProjectDomain, VercelProviderError } from "@/lib/domains/vercel"
import { isWebPushConfigured } from "@/lib/push-service"
import { createServiceRoleClient } from "@/lib/supabase"
import { requirePlatformRole, requirePlatformWriteAccess } from "@/lib/platform-authorization"
import { audit, type PlatformPage } from "@/lib/platform-admin"
import { parsePlatformFilters, type PlatformListFilters } from "@/lib/platform-filters"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PlatformDomainRow = {
  id: string
  hostname: string
  status: string
  verificationState: string
  providerVerified: boolean
  dnsConfigured: boolean
  lastCheckedAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  restaurantId: string
  restaurantName: string
  workspaceId: string | null
  workspaceName: string | null
  workspaceSlug: string | null
}

export type PlatformHealthStatus = "operational" | "warning" | "error" | "not_configured" | "unknown"

export type PlatformHealthItem = {
  key: string
  label: string
  status: PlatformHealthStatus
  detail: string
  metric?: string
}

function db() {
  return createServiceRoleClient() as ReturnType<typeof createServiceRoleClient> & { from(table: string): any }
}

function safeProviderError(error: unknown) {
  if (error instanceof VercelProviderError) return { code: error.code, message: error.message }
  return { code: "PROVIDER_ERROR", message: "The domain provider could not be checked." }
}

export async function listPlatformDomainsPage(input: Partial<PlatformListFilters> | string = ""): Promise<PlatformPage<PlatformDomainRow>> {
  const filters = parsePlatformFilters(typeof input === "string" ? { q: input } : input as Record<string, string | undefined>)
  await requirePlatformRole()
  const service = db()
  let query = service.from("restaurant_domains").select("id, hostname, status, verification_state, provider_verified, dns_configured, last_checked_at, last_error_code, last_error_message, restaurant_id", { count: "exact" }).order("updated_at", { ascending: false })
  const search = filters.q.replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim()
  if (search) query = query.ilike("hostname", `%${search}%`)
  if (filters.domain === "connected") query = query.eq("status", "active").eq("provider_verified", true).eq("dns_configured", true)
  if (filters.domain === "pending") query = query.in("status", ["pending", "verifying"])
  if (filters.domain === "problem") query = query.or("status.in.(error,suspended),verification_state.in.(failed,unknown),provider_verified.eq.false,dns_configured.eq.false")
  const from = (filters.page - 1) * filters.pageSize
  const { data, count, error } = await query.range(from, from + filters.pageSize - 1)
  if (error) throw new Error(error.message)
  const rows = data || []
  const restaurantIds = Array.from(new Set(rows.map((row: any) => row.restaurant_id).filter(Boolean)))
  const { data: restaurants, error: restaurantError } = restaurantIds.length ? await service.from("restaurants").select("id, name, workspace_id").in("id", restaurantIds) : { data: [], error: null }
  if (restaurantError) throw new Error(restaurantError.message)
  const workspaceIds = Array.from(new Set((restaurants || []).map((row: any) => row.workspace_id).filter(Boolean)))
  const { data: workspaces, error: workspaceError } = workspaceIds.length ? await service.from("workspaces").select("id, name, slug").in("id", workspaceIds) : { data: [], error: null }
  if (workspaceError) throw new Error(workspaceError.message)
  const restaurantById = new Map((restaurants || []).map((row: any) => [row.id, row]))
  const workspaceById = new Map((workspaces || []).map((row: any) => [row.id, row]))
  const items = rows.map((domain: any) => {
    const restaurant = restaurantById.get(domain.restaurant_id)
    const workspace = restaurant?.workspace_id ? workspaceById.get(restaurant.workspace_id) : null
    return { id: domain.id, hostname: domain.hostname, status: domain.status, verificationState: domain.verification_state, providerVerified: Boolean(domain.provider_verified), dnsConfigured: Boolean(domain.dns_configured), lastCheckedAt: domain.last_checked_at, lastErrorCode: domain.last_error_code, lastErrorMessage: domain.last_error_message, restaurantId: domain.restaurant_id, restaurantName: restaurant?.name || "Unknown restaurant", workspaceId: restaurant?.workspace_id || null, workspaceName: workspace?.name || null, workspaceSlug: workspace?.slug || null }
  })
  return { items, total: count || 0, page: filters.page, pageSize: filters.pageSize, hasNext: filters.page * filters.pageSize < (count || 0) }
}

export async function getPlatformBillingSnapshot() {
  await requirePlatformRole()
  const service = db()
  const [{ data: subscriptions, error: subscriptionError }, { data: overrides, error: overrideError }, { data: plans, error: planError }, { count: failedWebhookCount, error: webhookError }] = await Promise.all([
    service.from("workspace_subscriptions").select("workspace_id, plan_key, status, source, provider_status, provider, provider_environment, current_period_end"),
    service.from("subscription_overrides").select("workspace_id, id, plan_key, effective_until").is("revoked_at", null),
    service.from("plans").select("key, name, monthly_price_usd_cents"),
    service.from("billing_webhook_events").select("id", { count: "exact", head: true }).eq("status", "failed").gte("received_at", new Date(Date.now() - 7 * 86400000).toISOString()),
  ])
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (overrideError) throw new Error(overrideError.message)
  if (planError) throw new Error(planError.message)
  if (webhookError) throw new Error(webhookError.message)
  const now = Date.now()
  const soon = now + 14 * 86400000
  const distribution: Record<string, number> = Object.fromEntries((plans || []).map((plan: any) => [plan.key, 0]))
  let active = 0
  let pastDue = 0
  let canceled = 0
  let mismatches = 0
  for (const subscription of subscriptions || []) {
    distribution[subscription.plan_key] = (distribution[subscription.plan_key] || 0) + 1
    if (subscription.status === "active" || subscription.status === "trialing") active += 1
    if (subscription.status === "past_due") pastDue += 1
    if (subscription.status === "canceled") canceled += 1
    if (subscription.provider_status && subscription.provider_status !== subscription.status) mismatches += 1
  }
  return { distribution, paid: (subscriptions || []).filter((row: any) => row.plan_key !== "free").length, active, pastDue, canceled, overrides: (overrides || []).length, overridesExpiringSoon: (overrides || []).filter((row: any) => row.effective_until && new Date(row.effective_until).getTime() <= soon).length, providerMismatches: mismatches, failedWebhooksLast7d: failedWebhookCount || 0, billingConfigured: isPaddleBillingConfigured() }
}

export async function getPlatformHealth(): Promise<PlatformHealthItem[]> {
  await requirePlatformRole()
  const service = db()
  const [{ count: workspaceCount, error: databaseError }, { count: failedWebhooks, error: webhookError }, { count: domainProblems, error: domainError }, { count: emailFailures, error: emailFailureError }, { data: latestOutboxRun, error: outboxRunError }] = await Promise.all([
    service.from("workspaces").select("id", { count: "exact", head: true }),
    service.from("billing_webhook_events").select("id", { count: "exact", head: true }).eq("status", "failed").gte("received_at", new Date(Date.now() - 86400000).toISOString()),
    service.from("restaurant_domains").select("id", { count: "exact", head: true }).or("status.in.(error,suspended),verification_state.eq.failed"),
    service.from("email_delivery_events").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", new Date(Date.now() - 86400000).toISOString()),
    service.from("email_outbox_runs").select("id, status, finished_at, processed_count, sent_count, retrying_count, failed_count, error_code").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  const items: PlatformHealthItem[] = [
    { key: "database", label: "Supabase", status: databaseError ? "error" : "operational", detail: databaseError ? "The platform database check failed." : "Platform data queries are responding.", metric: databaseError ? undefined : `${workspaceCount || 0} workspaces` },
    { key: "paddle", label: "Paddle billing", status: webhookError ? "unknown" : isPaddleBillingConfigured() ? (failedWebhooks ? "warning" : "unknown") : "not_configured", detail: webhookError ? "Webhook history is not available in the current data model." : isPaddleBillingConfigured() ? (failedWebhooks ? "Failed webhook events were detected in the last 24 hours." : "Credentials are configured; provider reachability is not probed here.") : "Paddle credentials or environment are not configured." },
    { key: "domains", label: "Custom domains", status: domainError ? "error" : domainProblems ? "warning" : isVercelProviderConfigured() ? "unknown" : "not_configured", detail: domainError ? "Domain state could not be checked." : domainProblems ? "Some customer domains need verification or routing follow-up." : isVercelProviderConfigured() ? "Provider is configured; live reachability is checked per domain." : "Vercel domain credentials are not configured.", metric: domainError ? undefined : `${domainProblems || 0} problem domains` },
    { key: "email", label: "Email delivery", status: emailFailureError ? "unknown" : process.env.RESEND_API_KEY ? emailFailures ? "warning" : "unknown" : "not_configured", detail: emailFailureError ? "Delivery history is not available in the current data model." : process.env.RESEND_API_KEY ? (emailFailures ? "Failed delivery events were detected." : "Resend is configured; delivery health is not probed here.") : "Resend is not configured.", metric: emailFailureError ? undefined : emailFailures ? `${emailFailures} failures / 24h` : undefined },
    {
      key: "email_outbox",
      label: "Email outbox worker",
      status: outboxRunError ? "error" : !process.env.CRON_SECRET ? "not_configured" : !latestOutboxRun ? "unknown" : latestOutboxRun.status === "failed" ? "error" : latestOutboxRun.status === "running" ? "warning" : latestOutboxRun.failed_count > 0 ? "warning" : "operational",
      detail: outboxRunError ? "Outbox run health is unavailable; apply the email outbox observability migration." : !process.env.CRON_SECRET ? "CRON_SECRET is not configured." : !latestOutboxRun ? "The worker has not recorded a run yet." : latestOutboxRun.status === "failed" ? "The latest outbox invocation failed before completing." : latestOutboxRun.status === "running" ? "The latest outbox invocation is still running or recovering." : latestOutboxRun.failed_count > 0 ? "The latest invocation completed with delivery failures; inspect the private review queue." : "The latest outbox invocation completed.",
      metric: latestOutboxRun ? `${latestOutboxRun.processed_count} processed, ${latestOutboxRun.sent_count} sent, ${latestOutboxRun.retrying_count} retrying, ${latestOutboxRun.failed_count} failed` : undefined,
    },
    { key: "push", label: "Web Push", status: isWebPushConfigured() ? "unknown" : "not_configured", detail: isWebPushConfigured() ? "VAPID credentials are configured; delivery health is not probed here." : "Web Push credentials are not configured." },
  ]
  return items
}

export async function refreshPlatformDomain(domainId: string, reason?: string) {
  const access = await requirePlatformWriteAccess()
  if (!UUID_PATTERN.test(domainId)) throw new Error("Invalid domain identifier.")
  const service = db()
  const { data: domain, error: domainError } = await service.from("restaurant_domains").select("id, hostname, restaurant_id, status, verification_state, provider_verified, dns_configured, last_checked_at, last_error_code, last_error_message").eq("id", domainId).maybeSingle()
  if (domainError) throw new Error(domainError.message)
  if (!domain) throw new Error("Domain could not be found.")
  const before = { status: domain.status, verification_state: domain.verification_state, provider_verified: domain.provider_verified, dns_configured: domain.dns_configured, last_error_code: domain.last_error_code }
  try {
    let result = await getProjectDomain(domain.hostname)
    if (!result.domain.verified) {
      try { result = await verifyProjectDomain(domain.hostname) } catch { /* Preserve the provider challenge for the next recheck. */ }
    }
    const providerVerified = result.domain.verified === true
    const dnsConfigured = Boolean(result.dns && !result.dns.misconfigured)
    const after = { status: providerVerified && dnsConfigured ? "active" : "verifying", verification_state: providerVerified ? "verified" : "pending", provider_verified: providerVerified, dns_configured: dnsConfigured, verified_at: providerVerified ? new Date().toISOString() : null, last_checked_at: new Date().toISOString(), last_error_code: null, last_error_message: null }
    const { data: updated, error: updateError } = await service.from("restaurant_domains").update(after).eq("id", domain.id).select("id, hostname, status, verification_state, provider_verified, dns_configured, last_checked_at, last_error_code, last_error_message").single()
    if (updateError) throw new Error(updateError.message)
    await audit({ actorUserId: access.access.userId, action: "platform.domain.recheck", entityType: "restaurant_domain", entityId: domain.id, before, after, reason: reason || null, metadata: { hostname: domain.hostname, source: "platform_control" } })
    return { success: true, domain: updated }
  } catch (error) {
    const providerError = safeProviderError(error)
    const after = { status: providerError.code === "NOT_CONFIGURED" ? domain.status : "error", verification_state: providerError.code === "NOT_CONFIGURED" ? domain.verification_state : "failed", last_checked_at: new Date().toISOString(), last_error_code: providerError.code, last_error_message: providerError.message }
    await service.from("restaurant_domains").update(after).eq("id", domain.id)
    await audit({ actorUserId: access.access.userId, action: "platform.domain.recheck_failed", entityType: "restaurant_domain", entityId: domain.id, before, after, reason: reason || null, metadata: { hostname: domain.hostname, source: "platform_control" } })
    throw new Error(providerError.message)
  }
}
