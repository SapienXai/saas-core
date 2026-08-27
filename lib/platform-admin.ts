import "server-only"

import { createServiceRoleClient } from "@/lib/supabase"
import { requirePlatformBillingAccess, requirePlatformOwner, requirePlatformRole, requirePlatformWriteAccess } from "@/lib/platform-authorization"
import { FEATURE_KEYS, PLAN_KEYS, type FeatureKey, type PlanKey } from "@/lib/entitlements"
import { isPlatformRole } from "@/lib/platform-types"
import { parsePlatformFilters, type PlatformListFilters } from "@/lib/platform-filters"
import { deriveDomainAlerts, deriveWebhookAlerts, deriveWorkspaceAlerts, sortPlatformAlerts, type PlatformAlert } from "@/lib/platform-alerts"
import { getRestaurantPublicUrl } from "@/lib/domains/public-url"
import { normalizeBusinessEmail, normalizeOfficialDomain, normalizeOfficialWebsiteUrl } from "@/lib/claimable-restaurants"
import { provisionRestaurantWorkspace } from "@/lib/restaurant-provisioning"
import { parseRestaurantImportFile, type ParsedRestaurantImportRow, type RestaurantImportPayload } from "@/lib/platform-restaurant-import"
import { getRestaurantAiReadiness } from "@/lib/ai/readiness"
import { issueApiClient, type ApiScope } from "@/lib/ai/auth"
import { appendRestaurantSlugSuffix, normalizeSocialLinks, slugifyRestaurantName, validateOptionalPublicUrl, validateRestaurantSlug, validateSocialLinks, type RestaurantSocialLinks } from "@/lib/restaurant-profile"
import { audit } from "@/lib/platform-audit"
import { syncRestaurantWebsiteAssets, syncRestaurantWebsiteProfile, type WebsiteAssetSyncResult } from "@/lib/restaurant-website-assets"
import type { RestaurantWebsiteEnrichmentResult } from "@/lib/restaurant-website-enrichment"
import { importRestaurantFromWebsite, type WebsiteImportResult } from "@/lib/website-import"

export { audit } from "@/lib/platform-audit"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLATFORM_STATUSES = ["active", "suspended", "archived"] as const
type PlatformStatus = (typeof PLATFORM_STATUSES)[number]

const SETTINGS = ["maintenance_mode", "maintenance_message", "signup_enabled", "support_email", "default_locale", "default_timezone"] as const
export type PlatformSettingKey = (typeof SETTINGS)[number]

type PlatformDb = ReturnType<typeof createServiceRoleClient> & { from(table: string): any }

export type PlatformRestaurantImportMode = "create" | "update"

export type PlatformPage<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasNext: boolean
}

export async function issuePlatformApiClient(input: { name: string; scopes: ApiScope[]; rateLimitProfile?: "standard" | "partner" | "internal" }) {
  const { access } = await requirePlatformWriteAccess()
  const issued = await issueApiClient(input)
  await audit({
    actorUserId: access.userId,
    action: "platform.api_client.issued",
    entityType: "api_client",
    entityId: issued.client.id,
    after: { name: issued.client.name, scopes: issued.client.scopes, rateLimitProfile: issued.client.rate_limit_profile },
    metadata: { source: "platform_control", credentialReturnedOnce: true },
  })
  return issued
}

function pageResult<T>(items: T[], total: number, filters: PlatformListFilters): PlatformPage<T> {
  return { items, total, page: filters.page, pageSize: filters.pageSize, hasNext: filters.page * filters.pageSize < total }
}

function pageRange(filters: PlatformListFilters) {
  return [(filters.page - 1) * filters.pageSize, filters.page * filters.pageSize - 1] as const
}

function safeSearchTerm(value: string) {
  return value.replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim()
}

function currentPeriod() {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
  return { start, end }
}

function isAttentionWorkspace(workspace: { platform_status: string; subscriptionStatus: string; reservationUsage: number; reservationLimit: number | null; override?: { effectiveUntil: string | null } | null }) {
  const usageAttention = workspace.reservationLimit !== null && workspace.reservationUsage >= workspace.reservationLimit * 0.9
  const overrideAttention = Boolean(workspace.override?.effectiveUntil && new Date(workspace.override.effectiveUntil).getTime() <= Date.now() + 7 * 86400000)
  return workspace.platform_status === "suspended" || workspace.subscriptionStatus === "past_due" || workspace.subscriptionStatus === "unknown" || usageAttention || overrideAttention
}

async function getWorkspacePageRelated(ids: string[]) {
  if (ids.length === 0) return { subscriptions: [], overrides: [], restaurants: [], members: [], usage: [] }
  const service = db()
  const period = currentPeriod()
  const [{ data: subscriptions, error: subscriptionError }, { data: overrides, error: overrideError }, { data: restaurants, error: restaurantError }, { data: members, error: memberError }, { data: usage, error: usageError }] = await Promise.all([
    service.from("workspace_subscriptions").select("workspace_id, plan_key, status, source, current_period_start, current_period_end, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_price_id, provider_status, next_billed_at, scheduled_change_at, scheduled_change_action, billing_issue_code").in("workspace_id", ids),
    service.from("subscription_overrides").select("id, workspace_id, plan_key, effective_from, effective_until, reason, revoked_at").in("workspace_id", ids).is("revoked_at", null).order("effective_from", { ascending: false }),
    service.from("restaurants").select("id, workspace_id").in("workspace_id", ids),
    service.from("workspace_members").select("id, workspace_id").in("workspace_id", ids),
    service.from("workspace_usage_periods").select("workspace_id, period_start, period_end, reservations_created").in("workspace_id", ids).eq("period_start", period.start).eq("period_end", period.end),
  ])
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (overrideError) throw new Error(overrideError.message)
  if (restaurantError) throw new Error(restaurantError.message)
  if (memberError) throw new Error(memberError.message)
  if (usageError) throw new Error(usageError.message)
  return { subscriptions: subscriptions || [], overrides: overrides || [], restaurants: restaurants || [], members: members || [], usage: usage || [] }
}

function normalizeWorkspaceRows(workspaces: any[], related: Awaited<ReturnType<typeof getWorkspacePageRelated>>) {
  const now = Date.now()
  const subscriptionByWorkspace = new Map(related.subscriptions.map((row: any) => [row.workspace_id, row]))
  const overrideByWorkspace = new Map<string, any>()
  for (const override of related.overrides) {
    const start = new Date(override.effective_from).getTime()
    const end = override.effective_until ? new Date(override.effective_until).getTime() : Infinity
    if (start <= now && now < end && !overrideByWorkspace.has(override.workspace_id)) overrideByWorkspace.set(override.workspace_id, override)
  }
  const restaurantCounts = new Map<string, number>()
  const memberCounts = new Map<string, number>()
  const usageByWorkspace = new Map<string, any>()
  for (const row of related.restaurants) restaurantCounts.set(row.workspace_id, (restaurantCounts.get(row.workspace_id) || 0) + 1)
  for (const row of related.members) memberCounts.set(row.workspace_id, (memberCounts.get(row.workspace_id) || 0) + 1)
  for (const row of related.usage) usageByWorkspace.set(row.workspace_id, row)
  return workspaces.map((workspace: any) => {
    const subscription = subscriptionByWorkspace.get(workspace.id)
    const override = overrideByWorkspace.get(workspace.id)
    const result = {
      ...workspace,
      restaurantCount: restaurantCounts.get(workspace.id) || 0,
      memberCount: memberCounts.get(workspace.id) || 0,
      planKey: override?.plan_key || subscription?.plan_key || "free",
      subscriptionStatus: subscription?.status || "unknown",
      subscriptionSource: override ? "manual_override" : subscription?.source || "unknown",
      currentPeriodEnd: subscription?.current_period_end || null,
      reservationUsage: Number(usageByWorkspace.get(workspace.id)?.reservations_created || 0),
      reservationLimit: null as number | null,
      billing: subscription || null,
      override: override ? { id: override.id, planKey: override.plan_key, reason: override.reason, effectiveUntil: override.effective_until } : null,
    }
    return result
  })
}

async function resolvePlanLimits(rows: any[]) {
  const keys = Array.from(new Set(rows.map((row) => row.planKey).concat(["free"])))
  const { data, error } = await db().from("plans").select("key, reservation_limit, restaurant_limit, user_limit, name, monthly_price_usd_cents, features").in("key", keys)
  if (error) throw new Error(error.message)
  const byKey = new Map((data || []).map((plan: any) => [plan.key, plan]))
  return rows.map((row) => ({ ...row, reservationLimit: byKey.get(row.planKey)?.reservation_limit === null ? null : Number(byKey.get(row.planKey)?.reservation_limit || 0), plan: byKey.get(row.planKey) || null }))
}

export async function listPlatformWorkspacesPage(input: Partial<PlatformListFilters> | string = "") {
  const filters = parsePlatformFilters(typeof input === "string" ? { q: input } : input as Record<string, string | undefined>)
  await requirePlatformRole()
  const service = db()
  let query = service.from("workspaces").select("id, name, slug, status, platform_status, created_at, updated_at, onboarding_completed_at", { count: "exact" }).order("created_at", { ascending: false })
  const search = safeSearchTerm(filters.q)
  if (search) query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`)
  if (filters.status === "active" || filters.status === "suspended") query = query.eq("platform_status", filters.status)
  if (filters.plan !== "all") {
    const [{ data: subscriptions }, { data: overrides }] = await Promise.all([
      service.from("workspace_subscriptions").select("workspace_id").eq("plan_key", filters.plan),
      service.from("subscription_overrides").select("workspace_id").eq("plan_key", filters.plan).is("revoked_at", null),
    ])
    const ids = Array.from(new Set([...(subscriptions || []), ...(overrides || [])].map((row: any) => row.workspace_id)))
    if (ids.length === 0) return pageResult([], 0, filters)
    query = query.in("id", ids)
  }
  const [from, to] = pageRange(filters)
  const { data, count, error } = await query.range(from, to)
  if (error) throw new Error(error.message)
  const related = await getWorkspacePageRelated((data || []).map((row: any) => row.id))
  let rows = await resolvePlanLimits(normalizeWorkspaceRows(data || [], related))
  if (filters.billing === "past_due") rows = rows.filter((row) => row.subscriptionStatus === "past_due")
  if (filters.billing === "active") rows = rows.filter((row) => row.subscriptionStatus === "active" || row.subscriptionStatus === "trialing")
  if (filters.billing === "manual_override") rows = rows.filter((row) => Boolean(row.override))
  if (filters.usage === "normal") rows = rows.filter((row) => row.reservationLimit === null || row.reservationUsage < row.reservationLimit * 0.8)
  if (filters.usage === "approaching") rows = rows.filter((row) => row.reservationLimit !== null && row.reservationUsage >= row.reservationLimit * 0.8 && row.reservationUsage < row.reservationLimit)
  if (filters.usage === "at_limit") rows = rows.filter((row) => row.reservationLimit !== null && row.reservationUsage >= row.reservationLimit)
  if (filters.status === "attention" || filters.billing === "needs_attention") rows = rows.filter(isAttentionWorkspace)
  return pageResult(rows, filters.status === "all" && filters.billing === "all" && filters.usage === "all" ? count || 0 : rows.length, filters)
}

export async function listPlatformUsersPage(input: Partial<PlatformListFilters> | string = "") {
  const filters = parsePlatformFilters(typeof input === "string" ? { q: input } : input as Record<string, string | undefined>)
  await requirePlatformRole()
  const service = db()
  let query = service.from("platform_user_directory").select("user_id, email, full_name, last_sign_in_at, created_at", { count: "exact" }).order("created_at", { ascending: false })
  const search = safeSearchTerm(filters.q)
  if (search) query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
  const now = Date.now()
  if (filters.activity === "new") query = query.gte("created_at", new Date(now - 14 * 86400000).toISOString())
  if (filters.activity === "recent") query = query.gte("last_sign_in_at", new Date(now - 30 * 86400000).toISOString())
  if (filters.activity === "inactive") query = query.or(`last_sign_in_at.is.null,last_sign_in_at.lt.${new Date(now - 30 * 86400000).toISOString()}`)
  const [from, to] = pageRange(filters)
  const result = await query.range(from, to)
  let data = result.data
  let count = result.count
  if (result.error && isMissingPlatformDirectoryError(result.error)) {
    const normalizedSearch = safeSearchTerm(filters.q).toLowerCase()
    let fallbackRows = await listPlatformDirectoryUsers(service, 2000)
    if (normalizedSearch) fallbackRows = fallbackRows.filter((user) => `${user.email} ${user.full_name || ""}`.toLowerCase().includes(normalizedSearch))
    if (filters.activity === "new") fallbackRows = fallbackRows.filter((user) => new Date(user.created_at).getTime() >= now - 14 * 86400000)
    if (filters.activity === "recent") fallbackRows = fallbackRows.filter((user) => Boolean(user.last_sign_in_at && new Date(user.last_sign_in_at).getTime() >= now - 30 * 86400000))
    if (filters.activity === "inactive") fallbackRows = fallbackRows.filter((user) => !user.last_sign_in_at || new Date(user.last_sign_in_at).getTime() < now - 30 * 86400000)
    count = fallbackRows.length
    data = fallbackRows.slice(from, to + 1)
  } else if (result.error) {
    throw new Error(result.error.message)
  }
  const ids = (data || []).map((row: any) => row.user_id)
  const [{ data: profiles, error: profileError }, { data: members, error: memberError }, { data: controls, error: controlError }] = await Promise.all([
    ids.length ? service.from("admin_profiles").select("id, full_name, role").in("id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? service.from("platform_members").select("user_id, role, status").in("user_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? service.from("platform_user_controls").select("user_id, status, reason, suspended_at").in("user_id", ids) : Promise.resolve({ data: [], error: null }),
  ])
  if (profileError) throw new Error(profileError.message)
  if (memberError) throw new Error(memberError.message)
  if (controlError) throw new Error(controlError.message)
  const profileById = new Map((profiles || []).map((row: any) => [row.id, row]))
  const memberById = new Map((members || []).map((row: any) => [row.user_id, row]))
  const controlById = new Map((controls || []).map((row: any) => [row.user_id, row]))
  let rows = (data || []).map((user: any) => {
    const profile = profileById.get(user.user_id)
    const member = memberById.get(user.user_id)
    const control = controlById.get(user.user_id)
    return { id: user.user_id, email: user.email, name: user.full_name || profile?.full_name || "", workspaceRole: profile?.role || null, platformRole: member && isPlatformRole(member.role) && member.status === "active" ? member.role : null, platformMemberStatus: member?.status || null, status: control?.status || "active", suspensionReason: control?.reason || null, suspendedAt: control?.suspended_at || null, createdAt: user.created_at, lastSignInAt: user.last_sign_in_at || null }
  })
  if (filters.status === "active") rows = rows.filter((row) => row.status === "active")
  if (filters.status === "suspended") rows = rows.filter((row) => row.status === "suspended")
  return pageResult(rows, filters.status === "all" ? count || 0 : rows.length, filters)
}

export async function getPlatformUserDetail(userId: string) {
  await requirePlatformRole()
  if (!UUID_PATTERN.test(userId)) return null
  const service = db()
  const [directoryRows, { data: profile, error: profileError }, { data: platformMember, error: platformMemberError }, { data: control, error: controlError }, { data: memberships, error: membershipError }, { data: auditRows, error: auditError }] = await Promise.all([
    getPlatformDirectoryUsersByIds(service, [userId]),
    service.from("admin_profiles").select("id, full_name, role, created_at, updated_at").eq("id", userId).maybeSingle(),
    service.from("platform_members").select("user_id, role, status, created_at, updated_at").eq("user_id", userId).maybeSingle(),
    service.from("platform_user_controls").select("user_id, status, reason, suspended_at, created_at, updated_at").eq("user_id", userId).maybeSingle(),
    service.from("workspace_members").select("id, workspace_id, role, created_at").eq("user_id", userId).order("created_at", { ascending: true }),
    service.from("platform_audit_logs").select("id, action, entity_type, entity_id, reason, created_at").eq("entity_type", "user").eq("entity_id", userId).order("created_at", { ascending: false }).limit(12),
  ])
  if (profileError) throw new Error(profileError.message)
  if (platformMemberError) throw new Error(platformMemberError.message)
  if (controlError) throw new Error(controlError.message)
  if (membershipError) throw new Error(membershipError.message)
  if (auditError) throw new Error(auditError.message)
  const directory = directoryRows?.[0]
  if (!directory) return null
  const workspaceIds = Array.from(new Set((memberships || []).map((membership: any) => membership.workspace_id)))
  const { data: workspaces, error: workspaceError } = workspaceIds.length
    ? await service.from("workspaces").select("id, name, slug, status, platform_status").in("id", workspaceIds)
    : { data: [], error: null }
  if (workspaceError) throw new Error(workspaceError.message)
  const workspaceById = new Map((workspaces || []).map((workspace: any) => [workspace.id, workspace]))
  return {
    user: {
      id: userId,
      email: directory.email,
      name: directory.full_name || profile?.full_name || "",
      createdAt: directory.created_at,
      lastSignInAt: directory.last_sign_in_at || null,
      status: control?.status || "active",
      suspensionReason: control?.reason || null,
      suspendedAt: control?.suspended_at || null,
      workspaceRole: profile?.role || null,
      platformRole: platformMember && isPlatformRole(platformMember.role) && platformMember.status === "active" ? platformMember.role : null,
      platformMemberStatus: platformMember?.status || null,
    },
    workspaces: (memberships || []).map((membership: any) => ({ ...membership, workspace: workspaceById.get(membership.workspace_id) || null })),
    audit: auditRows || [],
  }
}

export async function listPlatformRestaurantsPage(input: Partial<PlatformListFilters> | string = "") {
  const filters = parsePlatformFilters(typeof input === "string" ? { q: input } : input as Record<string, string | undefined>)
  await requirePlatformRole()
  const service = db()
  let query = service.from("restaurants").select("id, name, slug, status, platform_status, workspace_id, reservation_enabled, created_at, updated_at", { count: "exact" }).order("created_at", { ascending: false })
  const search = safeSearchTerm(filters.q)
  if (search) query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`)
  if (filters.status === "active" || filters.status === "suspended") query = query.eq("platform_status", filters.status)
  const [from, to] = pageRange(filters)
  const needsClaimPostFilter = filters.plan !== "all" || filters.claim !== "all" || filters.source !== "all"
  const { data, count, error } = needsClaimPostFilter ? await query.limit(5000) : await query.range(from, to)
  if (error) throw new Error(error.message)
  const ids = Array.from(new Set((data || []).map((row: any) => row.workspace_id).filter(Boolean)))
  const [{ data: workspaces, error: workspaceError }, { data: subscriptions, error: subscriptionError }, { data: overrides, error: overrideError }, { data: claimProfiles, error: claimError }] = await Promise.all([
    ids.length ? service.from("workspaces").select("id, name, slug").in("id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? service.from("workspace_subscriptions").select("workspace_id, plan_key").in("workspace_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? service.from("subscription_overrides").select("workspace_id, plan_key, effective_from, effective_until").in("workspace_id", ids).is("revoked_at", null) : Promise.resolve({ data: [], error: null }),
    (data || []).length ? service.from("restaurant_claim_profiles").select("restaurant_id, ownership_status, source").in("restaurant_id", (data || []).map((row: any) => row.id)) : Promise.resolve({ data: [], error: null }),
  ])
  if (workspaceError) throw new Error(workspaceError.message)
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (overrideError) throw new Error(overrideError.message)
  if (claimError) throw new Error(claimError.message)
  const workspaceById = new Map((workspaces || []).map((row: any) => [row.id, row]))
  const subscriptionByWorkspace = new Map((subscriptions || []).map((row: any) => [row.workspace_id, row.plan_key]))
  const now = Date.now()
  const overrideByWorkspace = new Map<string, string>()
  for (const override of overrides || []) { const start = new Date(override.effective_from).getTime(); const end = override.effective_until ? new Date(override.effective_until).getTime() : Infinity; if (start <= now && now < end && !overrideByWorkspace.has(override.workspace_id)) overrideByWorkspace.set(override.workspace_id, override.plan_key) }
  const claimByRestaurant = new Map((claimProfiles || []).map((profile: any) => [profile.restaurant_id, profile]))
  let rows = (data || []).map((restaurant: any) => ({ ...restaurant, workspace: restaurant.workspace_id ? workspaceById.get(restaurant.workspace_id) || null : null, planKey: restaurant.workspace_id ? overrideByWorkspace.get(restaurant.workspace_id) || subscriptionByWorkspace.get(restaurant.workspace_id) || "free" : "free", claimProfile: claimByRestaurant.get(restaurant.id) || { ownership_status: "claimed", source: "legacy" } }))
  if (search) rows = rows.filter((row: any) => [row.name, row.slug, row.workspace?.name || "", row.workspace?.slug || ""].some((value) => value.toLowerCase().includes(search.toLowerCase())))
  if (filters.plan !== "all") rows = rows.filter((row: any) => row.planKey === filters.plan)
  if (filters.claim !== "all") rows = rows.filter((row: any) => row.claimProfile.ownership_status === filters.claim)
  if (filters.source !== "all") rows = rows.filter((row: any) => row.claimProfile.source === filters.source)
  if (needsClaimPostFilter) return pageResult(rows.slice(from, to + 1), rows.length, filters)
  return pageResult(rows, count || 0, filters)
}

export async function searchPlatformEntities(rawQuery: string) {
  await requirePlatformRole()
  const query = safeSearchTerm(rawQuery).slice(0, 80)
  if (query.length < 2) return { groups: [] }
  const service = db()
  const wildcard = `%${query}%`
  const idQuery = UUID_PATTERN.test(query) ? query : null
  const [{ data: workspaces, error: workspaceError }, { data: restaurants, error: restaurantError }, users, { data: domains, error: domainError }, { data: billing }] = await Promise.all([
    service.from("workspaces").select("id, name, slug, platform_status").or(`name.ilike.${wildcard},slug.ilike.${wildcard}`).order("updated_at", { ascending: false }).limit(8),
    service.from("restaurants").select("id, name, slug, workspace_id, platform_status").or(`name.ilike.${wildcard},slug.ilike.${wildcard}`).order("updated_at", { ascending: false }).limit(8),
    searchPlatformDirectoryUsers(service, query, 8),
    service.from("restaurant_domains").select("id, hostname, restaurant_id").ilike("hostname", wildcard).limit(8),
    service.from("workspace_subscriptions").select("workspace_id, provider_customer_id, provider_subscription_id, provider_price_id").or(`provider_customer_id.ilike.${wildcard},provider_subscription_id.ilike.${wildcard},provider_price_id.ilike.${wildcard}`).limit(8),
  ])
  if (workspaceError) throw new Error(workspaceError.message)
  if (restaurantError) throw new Error(restaurantError.message)
  if (domainError) throw new Error(domainError.message)
  const restaurantIds = Array.from(new Set((domains || []).map((row: any) => row.restaurant_id)))
  const workspaceIds = Array.from(new Set([...(billing || []).map((row: any) => row.workspace_id), ...(restaurants || []).map((row: any) => row.workspace_id).filter(Boolean)]))
  const [{ data: domainRestaurants }, { data: workspaceRows }] = await Promise.all([
    restaurantIds.length ? service.from("restaurants").select("id, name, slug, workspace_id").in("id", restaurantIds) : Promise.resolve({ data: [] }),
    workspaceIds.length ? service.from("workspaces").select("id, name, slug").in("id", workspaceIds) : Promise.resolve({ data: [] }),
  ])
  const workspaceById = new Map((workspaceRows || []).map((row: any) => [row.id, row]))
  const restaurantById = new Map((domainRestaurants || []).map((row: any) => [row.id, row]))
  const groups = [
    { type: "Workspaces", items: (workspaces || []).map((row: any) => ({ id: row.id, title: row.name, subtitle: row.slug, href: `/platform/workspaces/${row.id}`, meta: row.platform_status })) },
    { type: "Restaurants", items: (restaurants || []).map((row: any) => ({ id: row.id, title: row.name, subtitle: row.slug, href: `/platform/restaurants/${row.id}`, meta: workspaceById.get(row.workspace_id)?.name || "Legacy workspace" })) },
    { type: "Users", items: (users || []).map((row: any) => ({ id: row.user_id, title: row.full_name || row.email, subtitle: row.email, href: `/platform/users/${row.user_id}` })) },
    { type: "Domains", items: (domains || []).map((row: any) => ({ id: row.id, title: row.hostname, subtitle: restaurantById.get(row.restaurant_id)?.name || "Restaurant domain", href: `/platform/domains?domain=${encodeURIComponent(row.hostname)}` })) },
    { type: "Billing", items: (billing || []).map((row: any) => ({ id: row.workspace_id, title: workspaceById.get(row.workspace_id)?.name || "Workspace billing", subtitle: "Billing identifier match", href: `/platform/workspaces/${row.workspace_id}?tab=billing`, meta: "Billing" })) },
  ]
  if (idQuery) {
    const { data: reservations } = await service.from("reservations").select("id, restaurant_id, reservation_date, reservation_time").eq("id", idQuery).limit(1)
    if (reservations?.[0]) groups.push({ type: "Reservations", items: [{ id: reservations[0].id, title: reservations[0].id, subtitle: `${reservations[0].reservation_date} · ${reservations[0].reservation_time}`, href: `/platform/restaurants/${reservations[0].restaurant_id}` }] })
  }
  return { groups: groups.filter((group) => group.items.length > 0) }
}

export async function getPlatformWorkspaceDetail(workspaceId: string) {
  await requirePlatformRole()
  if (!UUID_PATTERN.test(workspaceId)) return null
  const service = db()
  const { data: workspace, error: workspaceError } = await service.from("workspaces").select("id, name, slug, status, platform_status, created_at, updated_at, onboarding_completed_at").eq("id", workspaceId).maybeSingle()
  if (workspaceError) throw new Error(workspaceError.message)
  if (!workspace) return null
  const period = currentPeriod()
  const [{ data: subscription, error: subscriptionError }, { data: overrides, error: overrideError }, { data: restaurants, error: restaurantError }, { data: members, error: memberError }, { data: usage, error: usageError }, { data: auditRows, error: auditError }] = await Promise.all([
    service.from("workspace_subscriptions").select("workspace_id, plan_key, status, source, current_period_start, current_period_end, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_price_id, provider_status, next_billed_at, scheduled_change_at, scheduled_change_action, billing_issue_code").eq("workspace_id", workspaceId).maybeSingle(),
    service.from("subscription_overrides").select("id, plan_key, effective_from, effective_until, reason, revoked_at").eq("workspace_id", workspaceId).is("revoked_at", null).order("effective_from", { ascending: false }),
    service.from("restaurants").select("id, name, slug, status, platform_status, reservation_enabled, updated_at, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    service.from("workspace_members").select("id, user_id, role, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    service.from("workspace_usage_periods").select("reservations_created, period_start, period_end").eq("workspace_id", workspaceId).eq("period_start", period.start).eq("period_end", period.end).maybeSingle(),
    service.from("platform_audit_logs").select("id, action, entity_type, entity_id, reason, created_at").eq("entity_type", "workspace").eq("entity_id", workspaceId).order("created_at", { ascending: false }).limit(8),
  ])
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (overrideError) throw new Error(overrideError.message)
  if (restaurantError) throw new Error(restaurantError.message)
  if (memberError) throw new Error(memberError.message)
  if (usageError) throw new Error(usageError.message)
  if (auditError) throw new Error(auditError.message)
  const restaurantIds = (restaurants || []).map((restaurant: any) => restaurant.id)
  const [{ data: workspaceDomains, error: workspaceDomainsError }, { data: workspaceNotifications, error: workspaceNotificationsError }, directoryRows, { count: reservationCount, error: reservationError }, { data: latestReservation, error: latestReservationError }] = await Promise.all([
    restaurantIds.length ? service.from("restaurant_domains").select("id, restaurant_id, hostname, status, verification_state, provider_verified, dns_configured, last_checked_at, last_error_code, last_error_message").in("restaurant_id", restaurantIds) : Promise.resolve({ data: [], error: null }),
    restaurantIds.length ? service.from("notification_settings").select("restaurant_id, email_notifications, sms_notifications, updated_at").in("restaurant_id", restaurantIds) : Promise.resolve({ data: [], error: null }),
    getPlatformDirectoryUsersByIds(service, (members || []).map((member: any) => member.user_id)),
    restaurantIds.length ? service.from("reservations").select("id", { count: "exact", head: true }).in("restaurant_id", restaurantIds).gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()) : Promise.resolve({ count: 0, error: null }),
    restaurantIds.length ? service.from("reservations").select("created_at").in("restaurant_id", restaurantIds).order("created_at", { ascending: false }).limit(1) : Promise.resolve({ data: [], error: null }),
  ])
  if (workspaceDomainsError) throw new Error(workspaceDomainsError.message)
  if (workspaceNotificationsError) throw new Error(workspaceNotificationsError.message)
  if (reservationError) throw new Error(reservationError.message)
  if (latestReservationError) throw new Error(latestReservationError.message)
  const override = (overrides || []).find((item: any) => new Date(item.effective_from).getTime() <= Date.now() && (!item.effective_until || new Date(item.effective_until).getTime() > Date.now())) || null
  const planKey = override?.plan_key || subscription?.plan_key || "free"
  const { data: plan, error: planError } = await service.from("plans").select("key, name, monthly_price_usd_cents, restaurant_limit, user_limit, reservation_limit, history_days, features").eq("key", planKey).maybeSingle()
  if (planError) throw new Error(planError.message)
  const directoryById = new Map((directoryRows || []).map((row: any) => [row.user_id, row]))
  const detailMembers = (members || []).map((member: any) => ({ ...member, email: directoryById.get(member.user_id)?.email || "Unknown email", name: directoryById.get(member.user_id)?.full_name || null }))
  const owner = detailMembers.find((member: any) => member.role === "owner") || null
  const billingStatus = subscription?.status === "active" || subscription?.status === "trialing" ? "operational" : subscription?.status === "past_due" ? "warning" : subscription?.status ? "error" : "unknown"
  const domainStatus = !(workspaceDomains || []).length ? "not_configured" : (workspaceDomains || []).some((domain: any) => domain.status === "error" || domain.verification_state === "failed") ? "error" : (workspaceDomains || []).some((domain: any) => domain.status !== "active" || !domain.provider_verified || !domain.dns_configured) ? "warning" : "operational"
  const notificationStatus = !(workspaceNotifications || []).length ? "not_configured" : (workspaceNotifications || []).some((setting: any) => setting.email_notifications || setting.sms_notifications) ? "operational" : "warning"
  const bookingStatus = !(restaurants || []).length ? "not_configured" : (restaurants || []).some((restaurant: any) => restaurant.reservation_enabled) ? "operational" : "warning"
  const lastActivity = latestReservation?.[0]?.created_at || (restaurants || []).map((restaurant: any) => restaurant.updated_at).sort().at(-1) || null
  return {
    workspace,
    planKey,
    plan: plan || { key: planKey, name: planKey, restaurant_limit: null, user_limit: null, reservation_limit: null, features: {} },
    subscriptionStatus: subscription?.status || "unknown",
    subscriptionSource: override ? "manual_override" : subscription?.source || "unknown",
    currentPeriodEnd: subscription?.current_period_end || null,
    billing: subscription || null,
    override: override ? { id: override.id, planKey: override.plan_key, reason: override.reason, effectiveUntil: override.effective_until } : null,
    restaurants: restaurants || [],
    members: detailMembers,
    domains: workspaceDomains || [],
    reservationUsage: Number(usage?.reservations_created || reservationCount || 0),
    reservationLimit: plan?.reservation_limit === null ? null : Number(plan?.reservation_limit || 0),
    restaurantCount: (restaurants || []).length,
    restaurantLimit: plan?.restaurant_limit === null ? null : Number(plan?.restaurant_limit || 0),
    memberCount: (members || []).length,
    memberLimit: plan?.user_limit === null ? null : Number(plan?.user_limit || 0),
    lastActivity,
    owner,
    health: [
      { key: "booking", label: "Booking state", status: bookingStatus },
      { key: "billing", label: "Billing state", status: billingStatus },
      { key: "domain", label: "Domain state", status: domainStatus },
      { key: "notifications", label: "Notifications", status: notificationStatus },
    ],
    audit: auditRows || [],
  }
}

function db() {
  return createServiceRoleClient() as PlatformDb
}

type PlatformDirectoryRow = {
  user_id: string
  email: string
  full_name: string | null
  last_sign_in_at: string | null
  created_at: string
}

function isMissingPlatformDirectoryError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "PGRST205" && error.message?.includes("platform_user_directory")
}

function toPlatformDirectoryRow(user: { id: string; email?: string; user_metadata?: Record<string, unknown>; last_sign_in_at?: string | null; created_at?: string }) {
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : ""
  return {
    user_id: user.id,
    email: user.email || "",
    full_name: fullName || null,
    last_sign_in_at: user.last_sign_in_at || null,
    created_at: user.created_at || new Date(0).toISOString(),
  }
}

async function listPlatformDirectoryUsers(service: PlatformDb, limit = 1000): Promise<PlatformDirectoryRow[]> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 2000)
  const { data, error } = await service
    .from("platform_user_directory")
    .select("user_id, email, full_name, last_sign_in_at, created_at")
    .order("created_at", { ascending: false })
    .limit(boundedLimit)

  if (!error) return data || []
  if (!isMissingPlatformDirectoryError(error)) throw new Error(error.message)

  const users: PlatformDirectoryRow[] = []
  const perPage = Math.min(boundedLimit, 1000)
  for (let page = 1; users.length < boundedLimit; page += 1) {
    const { data: authData, error: authError } = await service.auth.admin.listUsers({ page, perPage })
    if (authError) throw new Error(`Platform user directory fallback failed: ${authError.message}`)
    const pageUsers = authData.users || []
    users.push(...pageUsers.map(toPlatformDirectoryRow))
    if (pageUsers.length < perPage) break
  }
  return users.slice(0, boundedLimit)
}

async function searchPlatformDirectoryUsers(service: PlatformDb, query: string, limit = 8) {
  const wildcard = `%${query}%`
  const { data, error } = await service
    .from("platform_user_directory")
    .select("user_id, email, full_name")
    .or(`email.ilike.${wildcard},full_name.ilike.${wildcard}`)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (!error) return data || []
  if (!isMissingPlatformDirectoryError(error)) throw new Error(error.message)
  const normalizedQuery = query.toLowerCase()
  return (await listPlatformDirectoryUsers(service, 1000))
    .filter((user) => `${user.email} ${user.full_name || ""}`.toLowerCase().includes(normalizedQuery))
    .slice(0, limit)
}

async function getPlatformDirectoryUsersByIds(service: PlatformDb, userIds: string[]) {
  if (userIds.length === 0) return []
  const { data, error } = await service
    .from("platform_user_directory")
    .select("user_id, email, full_name, last_sign_in_at, created_at")
    .in("user_id", userIds)

  if (!error) return data || []
  if (!isMissingPlatformDirectoryError(error)) throw new Error(error.message)
  const ids = new Set(userIds)
  return (await listPlatformDirectoryUsers(service, 1000)).filter((user) => ids.has(user.user_id))
}

async function getPlatformDirectoryCount(service: PlatformDb) {
  const { count, error } = await service.from("platform_user_directory").select("user_id", { count: "exact", head: true })
  if (error && !isMissingPlatformDirectoryError(error)) throw new Error(error.message)
  if (!error && typeof count === "number") return count
  return (await listPlatformDirectoryUsers(service, 2000)).length
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} is invalid.`)
}

function assertReason(reason: string | undefined) {
  const value = reason?.trim() || ""
  if (value.length < 3 || value.length > 500) throw new Error("A reason between 3 and 500 characters is required.")
  return value
}

function assertPlatformStatus(value: string): PlatformStatus {
  if (!PLATFORM_STATUSES.includes(value as PlatformStatus)) throw new Error("Invalid platform status.")
  return value as PlatformStatus
}

function assertPlanKey(value: string): PlanKey {
  if (!PLAN_KEYS.includes(value as PlanKey)) throw new Error("Invalid plan key.")
  return value as PlanKey
}

async function getWorkspaceCounts() {
  const service = db()
  const [{ data: restaurants, error: restaurantError }, { data: members, error: memberError }] = await Promise.all([
    service.from("restaurants").select("workspace_id").limit(5000),
    service.from("workspace_members").select("workspace_id").limit(10000),
  ])
  if (restaurantError) throw new Error(restaurantError.message)
  if (memberError) throw new Error(memberError.message)
  const restaurantCounts = new Map<string, number>()
  const memberCounts = new Map<string, number>()
  for (const row of restaurants || []) if (row.workspace_id) restaurantCounts.set(row.workspace_id, (restaurantCounts.get(row.workspace_id) || 0) + 1)
  for (const row of members || []) if (row.workspace_id) memberCounts.set(row.workspace_id, (memberCounts.get(row.workspace_id) || 0) + 1)
  return { restaurantCounts, memberCounts }
}

export async function getPlatformOverview() {
  await requirePlatformRole()
  const service = db()
  const [users, { count: workspaces, error: workspaceError }, { count: restaurants, error: restaurantError }, { count: suspendedUsers, error: suspendedUserError }, { count: suspendedWorkspaces, error: suspendedWorkspaceError }, { count: suspendedRestaurants, error: suspendedRestaurantError }, { data: planRows, error: planError }, { data: auditRows, error: auditError }] = await Promise.all([
    getPlatformDirectoryCount(service),
    service.from("workspaces").select("id", { count: "exact", head: true }),
    service.from("restaurants").select("id", { count: "exact", head: true }),
    service.from("platform_user_controls").select("user_id", { count: "exact", head: true }).eq("status", "suspended"),
    service.from("workspaces").select("id", { count: "exact", head: true }).eq("platform_status", "suspended"),
    service.from("restaurants").select("id", { count: "exact", head: true }).eq("platform_status", "suspended"),
    service.from("workspace_subscriptions").select("plan_key"),
    service.from("platform_audit_logs").select("id, actor_user_id, action, entity_type, entity_id, reason, created_at").order("created_at", { ascending: false }).limit(8),
  ])
  if (workspaceError) throw new Error(workspaceError.message)
  if (restaurantError) throw new Error(restaurantError.message)
  if (suspendedUserError) throw new Error(suspendedUserError.message)
  if (suspendedWorkspaceError) throw new Error(suspendedWorkspaceError.message)
  if (suspendedRestaurantError) throw new Error(suspendedRestaurantError.message)
  if (planError) throw new Error(planError.message)
  if (auditError) throw new Error(auditError.message)

  const planDistribution = Object.fromEntries(PLAN_KEYS.map((key) => [key, 0])) as Record<PlanKey, number>
  for (const row of planRows || []) if (row.plan_key in planDistribution) planDistribution[row.plan_key as PlanKey] += 1
  return {
    counts: {
      users: users || 0,
      workspaces: workspaces || 0,
      restaurants: restaurants || 0,
      suspendedUsers: suspendedUsers || 0,
      suspendedWorkspaces: suspendedWorkspaces || 0,
      suspendedRestaurants: suspendedRestaurants || 0,
    },
    planDistribution,
    recentAudit: auditRows || [],
  }
}

export async function getPlatformAlerts(): Promise<PlatformAlert[]> {
  await requirePlatformRole()
  const service = db()
  const now = new Date()
  const horizon = new Date(now.getTime() + 7 * 86400000)
  const period = currentPeriod()
  const [{ data: workspaces, error: workspaceError }, { data: subscriptions, error: subscriptionError }, { data: plans, error: planError }, { data: usage, error: usageError }, { data: overrides, error: overrideError }, { data: domains, error: domainError }, { data: failedWebhooks, error: webhookError }] = await Promise.all([
    service.from("workspaces").select("id, name, slug, platform_status").limit(10000),
    service.from("workspace_subscriptions").select("workspace_id, plan_key, status, provider_status, billing_issue_code").limit(10000),
    service.from("plans").select("key, reservation_limit"),
    service.from("workspace_usage_periods").select("workspace_id, reservations_created").eq("period_start", period.start).eq("period_end", period.end),
    service.from("subscription_overrides").select("id, workspace_id, effective_until").is("revoked_at", null).gte("effective_until", now.toISOString()).lte("effective_until", horizon.toISOString()),
    service.from("restaurant_domains").select("id, hostname, restaurant_id, status, verification_state, provider_verified, dns_configured, last_checked_at, last_error_code").or("status.in.(pending,verifying,error,suspended),verification_state.in.(pending,failed,unknown),provider_verified.eq.false,dns_configured.eq.false").limit(1000),
    service.from("billing_webhook_events").select("id, event_type, workspace_id, received_at").eq("status", "failed").gte("received_at", new Date(now.getTime() - 7 * 86400000).toISOString()).order("received_at", { ascending: false }).limit(100),
  ])
  if (workspaceError) throw new Error(workspaceError.message)
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (planError) throw new Error(planError.message)
  if (usageError) throw new Error(usageError.message)
  if (overrideError) throw new Error(overrideError.message)
  if (domainError) throw new Error(domainError.message)
  if (webhookError) throw new Error(webhookError.message)

  const workspaceRows = workspaces || []
  const workspaceById = new Map(workspaceRows.map((row: any) => [row.id, row]))
  const subscriptionByWorkspace = new Map((subscriptions || []).map((row: any) => [row.workspace_id, row]))
  const usageByWorkspace = new Map((usage || []).map((row: any) => [row.workspace_id, row]))
  const overrideByWorkspace = new Map<string, any>()
  for (const override of overrides || []) if (!overrideByWorkspace.has(override.workspace_id)) overrideByWorkspace.set(override.workspace_id, override)
  const planLimits = new Map((plans || []).map((row: any) => [row.key, row.reservation_limit === null ? null : Number(row.reservation_limit)]))
  const workspaceSnapshots = workspaceRows.map((workspace: any) => {
    const subscription = subscriptionByWorkspace.get(workspace.id)
    const override = overrideByWorkspace.get(workspace.id)
    const planKey = subscription?.plan_key || "free"
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      platformStatus: workspace.platform_status,
      subscriptionStatus: subscription?.status || null,
      providerStatus: subscription?.provider_status || null,
      billingIssueCode: subscription?.billing_issue_code || null,
      reservationUsage: Number(usageByWorkspace.get(workspace.id)?.reservations_created || 0),
      reservationLimit: planLimits.get(override?.plan_key || planKey) ?? null,
      overrideId: override?.id || null,
      overrideEffectiveUntil: override?.effective_until || null,
    }
  })

  const domainRows = domains || []
  const restaurantIds = Array.from(new Set(domainRows.map((row: any) => row.restaurant_id).filter(Boolean)))
  const { data: restaurants, error: restaurantError } = restaurantIds.length ? await service.from("restaurants").select("id, name, workspace_id").in("id", restaurantIds) : { data: [], error: null }
  if (restaurantError) throw new Error(restaurantError.message)
  const restaurantById = new Map((restaurants || []).map((row: any) => [row.id, row]))
  const domainSnapshots = domainRows.map((domain: any) => {
    const restaurant = restaurantById.get(domain.restaurant_id)
    const workspace = restaurant?.workspace_id ? workspaceById.get(restaurant.workspace_id) : null
    return { id: domain.id, hostname: domain.hostname, restaurantId: domain.restaurant_id, restaurantName: restaurant?.name || "Restaurant", workspaceId: restaurant?.workspace_id || null, workspaceName: workspace?.name || null, status: domain.status, verificationState: domain.verification_state, providerVerified: Boolean(domain.provider_verified), dnsConfigured: Boolean(domain.dns_configured), lastCheckedAt: domain.last_checked_at, lastErrorCode: domain.last_error_code }
  })
  const webhookSnapshots = (failedWebhooks || []).map((event: any) => ({ id: event.id, eventType: event.event_type, workspaceId: event.workspace_id, workspaceName: event.workspace_id ? workspaceById.get(event.workspace_id)?.name || null : null, receivedAt: event.received_at }))
  return sortPlatformAlerts([
    ...deriveWorkspaceAlerts(workspaceSnapshots),
    ...deriveDomainAlerts(domainSnapshots),
    ...deriveWebhookAlerts(webhookSnapshots),
  ])
}

export async function listPlatformWorkspaces(search = "") {
  await requirePlatformRole()
  const service = db()
  const [{ data: workspaces, error: workspaceError }, { data: subscriptions, error: subscriptionError }, { data: overrides, error: overrideError }, counts] = await Promise.all([
    service.from("workspaces").select("id, name, slug, status, platform_status, created_at, updated_at").order("created_at", { ascending: false }).limit(1000),
    service.from("workspace_subscriptions").select("workspace_id, plan_key, status, source, current_period_end").limit(1000),
    service.from("subscription_overrides").select("id, workspace_id, plan_key, effective_from, effective_until, reason, revoked_at").is("revoked_at", null).order("effective_from", { ascending: false }).limit(2000),
    getWorkspaceCounts(),
  ])
  if (workspaceError) throw new Error(workspaceError.message)
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (overrideError) throw new Error(overrideError.message)

  const now = Date.now()
  const subscriptionByWorkspace = new Map((subscriptions || []).map((row) => [row.workspace_id, row]))
  const overrideByWorkspace = new Map<string, any>()
  for (const override of overrides || []) {
    const start = new Date(override.effective_from).getTime()
    const end = override.effective_until ? new Date(override.effective_until).getTime() : Infinity
    if (start <= now && now < end && !overrideByWorkspace.has(override.workspace_id)) overrideByWorkspace.set(override.workspace_id, override)
  }
  const normalizedSearch = search.trim().toLowerCase()
  return (workspaces || [])
    .filter((workspace) => !normalizedSearch || [workspace.name, workspace.slug].some((value) => value.toLowerCase().includes(normalizedSearch)))
    .map((workspace) => {
      const subscription = subscriptionByWorkspace.get(workspace.id)
      const override = overrideByWorkspace.get(workspace.id)
      return {
        ...workspace,
        restaurantCount: counts.restaurantCounts.get(workspace.id) || 0,
        memberCount: counts.memberCounts.get(workspace.id) || 0,
        planKey: override?.plan_key || subscription?.plan_key || "free",
        subscriptionStatus: subscription?.status || "unknown",
        subscriptionSource: override ? "manual_override" : subscription?.source || "unknown",
        currentPeriodEnd: subscription?.current_period_end || null,
        override: override ? { id: override.id, planKey: override.plan_key, reason: override.reason, effectiveUntil: override.effective_until } : null,
      }
    })
}

export async function listPlatformUsers(search = "") {
  await requirePlatformRole()
  const service = db()
  const [{ data: profiles, error: profileError }, { data: members, error: memberError }, { data: controls, error: controlError }, directory] = await Promise.all([
    service.from("admin_profiles").select("id, full_name, role"),
    service.from("platform_members").select("user_id, role, status"),
    service.from("platform_user_controls").select("user_id, status, reason, suspended_at"),
    listPlatformDirectoryUsers(service, 2000),
  ])
  if (profileError) throw new Error(profileError.message)
  if (memberError) throw new Error(memberError.message)
  if (controlError) throw new Error(controlError.message)

  const profileById = new Map((profiles || []).map((row) => [row.id, row]))
  const memberById = new Map((members || []).map((row) => [row.user_id, row]))
  const controlById = new Map((controls || []).map((row) => [row.user_id, row]))
  const normalizedSearch = search.trim().toLowerCase()
  return (directory || [])
    .map((user) => {
      const profile = profileById.get(user.user_id)
      const member = memberById.get(user.user_id)
      const control = controlById.get(user.user_id)
      return {
        id: user.user_id,
        email: user.email || "",
        name: user.full_name || profile?.full_name || "",
        workspaceRole: profile?.role || null,
        platformRole: member && isPlatformRole(member.role) && member.status === "active" ? member.role : null,
        platformMemberStatus: member?.status || null,
        status: control?.status || "active",
        suspensionReason: control?.reason || null,
        suspendedAt: control?.suspended_at || null,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at || null,
      }
    })
    .filter((user) => !normalizedSearch || [user.email, user.name].some((value) => value.toLowerCase().includes(normalizedSearch)))
}

export async function listPlatformRestaurants(search = "") {
  await requirePlatformRole()
  const service = db()
  const [{ data: restaurants, error: restaurantError }, { data: workspaces, error: workspaceError }, { data: subscriptions, error: subscriptionError }, { data: overrides, error: overrideError }] = await Promise.all([
    service.from("restaurants").select("id, name, slug, status, platform_status, workspace_id, created_at, updated_at").order("created_at", { ascending: false }).limit(2000),
    service.from("workspaces").select("id, name, slug").limit(1000),
    service.from("workspace_subscriptions").select("workspace_id, plan_key").limit(1000),
    service.from("subscription_overrides").select("workspace_id, plan_key, effective_from, effective_until").is("revoked_at", null).limit(2000),
  ])
  if (restaurantError) throw new Error(restaurantError.message)
  if (workspaceError) throw new Error(workspaceError.message)
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (overrideError) throw new Error(overrideError.message)
  const workspaceById = new Map((workspaces || []).map((workspace) => [workspace.id, workspace]))
  const subscriptionByWorkspace = new Map((subscriptions || []).map((subscription) => [subscription.workspace_id, subscription.plan_key]))
  const now = Date.now()
  const overrideByWorkspace = new Map<string, string>()
  for (const override of overrides || []) {
    const start = new Date(override.effective_from).getTime()
    const end = override.effective_until ? new Date(override.effective_until).getTime() : Infinity
    if (start <= now && now < end && !overrideByWorkspace.has(override.workspace_id)) overrideByWorkspace.set(override.workspace_id, override.plan_key)
  }
  const normalizedSearch = search.trim().toLowerCase()
  return (restaurants || [])
    .map((restaurant) => ({
      ...restaurant,
      workspace: restaurant.workspace_id ? workspaceById.get(restaurant.workspace_id) || null : null,
      planKey: restaurant.workspace_id ? overrideByWorkspace.get(restaurant.workspace_id) || subscriptionByWorkspace.get(restaurant.workspace_id) || "free" : "free",
    }))
    .filter((restaurant) => !normalizedSearch || [restaurant.name, restaurant.slug, restaurant.workspace?.name || ""].some((value) => value.toLowerCase().includes(normalizedSearch)))
}

export async function listPlatformPlans() {
  await requirePlatformRole()
  const { data, error } = await db().from("plans").select("key, name, monthly_price_usd_cents, active, restaurant_limit, user_limit, reservation_limit, history_days, features, sort_order").order("sort_order", { ascending: true }).limit(50)
  if (error) throw new Error(error.message)
  return data || []
}

export async function listPlatformMembers() {
  await requirePlatformOwner()
  const service = db()
  const [{ data: members, error }, directory] = await Promise.all([
    service.from("platform_members").select("user_id, role, status, created_by, created_at, updated_at").order("created_at", { ascending: true }).limit(500),
    listPlatformDirectoryUsers(service, 2000),
  ])
  if (error) throw new Error(error.message)
  const userById = new Map((directory || []).map((user: any) => [user.user_id, user]))
  return (members || []).map((member) => ({
    ...member,
    email: userById.get(member.user_id)?.email || "Unknown email",
    name: userById.get(member.user_id)?.full_name || null,
  }))
}

export async function listPlatformAuditLogs(limit = 100, search = "") {
  await requirePlatformRole()
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 250)
  const service = db()
  let logsQuery = service.from("platform_audit_logs").select("id, actor_user_id, action, entity_type, entity_id, before_data, after_data, reason, metadata, created_at").order("created_at", { ascending: false }).limit(safeLimit)
  const normalizedSearch = safeSearchTerm(search)
  if (normalizedSearch) logsQuery = logsQuery.or(`action.ilike.%${normalizedSearch}%,entity_type.ilike.%${normalizedSearch}%,reason.ilike.%${normalizedSearch}%`)
  const [{ data: logs, error }, directory] = await Promise.all([
    logsQuery,
    listPlatformDirectoryUsers(service, 2000),
  ])
  if (error) throw new Error(error.message)
  const userById = new Map((directory || []).map((user: any) => [user.user_id, user]))
  return (logs || []).map((log) => ({
    ...log,
    actorEmail: log.actor_user_id ? userById.get(log.actor_user_id)?.email || "Deleted user" : "System",
  }))
}

export async function listPlatformSettings() {
  await requirePlatformRole()
  const { data, error } = await db().from("platform_settings").select("key, value, updated_by, updated_at").order("key").limit(100)
  if (error) throw new Error(error.message)
  return data || []
}

export async function setPlatformUserStatus(userId: string, status: "active" | "suspended", reason?: string) {
  const { access } = await requirePlatformWriteAccess()
  assertUuid(userId, "User ID")
  const normalizedReason = status === "suspended" ? assertReason(reason) : reason?.trim() || null
  const service = db()
  const { data: before } = await service.from("platform_user_controls").select("user_id, status, reason, suspended_at").eq("user_id", userId).maybeSingle()
  const after = { user_id: userId, status, reason: normalizedReason, suspended_by: status === "suspended" ? access.userId : null, suspended_at: status === "suspended" ? new Date().toISOString() : null }
  const { error } = await service.from("platform_user_controls").upsert(after, { onConflict: "user_id" })
  if (error) throw new Error(error.message)
  await audit({ actorUserId: access.userId, action: status === "suspended" ? "user.suspend" : "user.reactivate", entityType: "user", entityId: userId, before: before || {}, after, reason: normalizedReason })
  return { success: true }
}

export async function setPlatformWorkspaceStatus(workspaceId: string, status: string, reason?: string) {
  const { access } = await requirePlatformWriteAccess()
  assertUuid(workspaceId, "Workspace ID")
  const nextStatus = assertPlatformStatus(status)
  const normalizedReason = assertReason(reason)
  const service = db()
  const { data: before, error: readError } = await service.from("workspaces").select("id, platform_status").eq("id", workspaceId).single()
  if (readError || !before) throw new Error(readError?.message || "Workspace not found.")
  const { data: after, error } = await service.from("workspaces").update({ platform_status: nextStatus }).eq("id", workspaceId).select("id, platform_status").single()
  if (error || !after) throw new Error(error?.message || "Workspace status could not be updated.")
  await audit({ actorUserId: access.userId, action: "workspace.status_change", entityType: "workspace", entityId: workspaceId, before, after, reason: normalizedReason })
  return { success: true }
}

export async function setPlatformRestaurantStatus(restaurantId: string, status: string, reason?: string) {
  const { access } = await requirePlatformWriteAccess()
  assertUuid(restaurantId, "Restaurant ID")
  const nextStatus = assertPlatformStatus(status)
  const normalizedReason = assertReason(reason)
  const service = db()
  const { data: before, error: readError } = await service.from("restaurants").select("id, platform_status").eq("id", restaurantId).single()
  if (readError || !before) throw new Error(readError?.message || "Restaurant not found.")
  const { data: after, error } = await service.from("restaurants").update({ platform_status: nextStatus }).eq("id", restaurantId).select("id, platform_status").single()
  if (error || !after) throw new Error(error?.message || "Restaurant status could not be updated.")
  await audit({ actorUserId: access.userId, action: "restaurant.status_change", entityType: "restaurant", entityId: restaurantId, before, after, reason: normalizedReason })
  return { success: true }
}

export async function createSubscriptionOverride(input: { workspaceId: string; planKey: string; effectiveFrom?: string; effectiveUntil?: string; reason: string }) {
  const { access } = await requirePlatformBillingAccess()
  assertUuid(input.workspaceId, "Workspace ID")
  const planKey = assertPlanKey(input.planKey)
  const reason = assertReason(input.reason)
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date()
  const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveUntil && Number.isNaN(effectiveUntil.getTime())) || (effectiveUntil && effectiveUntil <= effectiveFrom)) throw new Error("Override dates are invalid.")
  const service = db()
  const { data: workspace, error: workspaceError } = await service.from("workspaces").select("id, name").eq("id", input.workspaceId).maybeSingle()
  if (workspaceError || !workspace) throw new Error(workspaceError?.message || "Workspace not found.")
  const { data: created, error } = await service.from("subscription_overrides").insert({ workspace_id: input.workspaceId, plan_key: planKey, effective_from: effectiveFrom.toISOString(), effective_until: effectiveUntil?.toISOString() || null, reason, created_by: access.userId }).select("id, workspace_id, plan_key, effective_from, effective_until, reason").single()
  if (error || !created) throw new Error(error?.message || "Subscription override could not be created.")
  await audit({ actorUserId: access.userId, action: "subscription.override_create", entityType: "workspace", entityId: input.workspaceId, after: created, reason, metadata: { workspaceName: workspace.name } })
  return { success: true, data: created }
}

export async function revokeSubscriptionOverride(overrideId: string, reason: string) {
  const { access } = await requirePlatformBillingAccess()
  assertUuid(overrideId, "Override ID")
  const normalizedReason = assertReason(reason)
  const service = db()
  const { data: before, error: readError } = await service.from("subscription_overrides").select("id, workspace_id, plan_key, revoked_at, reason").eq("id", overrideId).single()
  if (readError || !before) throw new Error(readError?.message || "Override not found.")
  if (before.revoked_at) return { success: true }
  const { data: after, error } = await service.from("subscription_overrides").update({ revoked_at: new Date().toISOString(), revoked_by: access.userId }).eq("id", overrideId).select("id, workspace_id, plan_key, revoked_at, revoked_by").single()
  if (error || !after) throw new Error(error?.message || "Override could not be revoked.")
  await audit({ actorUserId: access.userId, action: "subscription.override_revoke", entityType: "workspace", entityId: before.workspace_id, before, after, reason: normalizedReason })
  return { success: true }
}

export async function updatePlanCatalog(input: {
  planKey: string
  name: string
  monthlyPriceUsdCents: number
  restaurantLimit: number
  userLimit: number
  reservationLimit: number | null
  historyDays: number | null
  features: Partial<Record<FeatureKey, boolean>>
  reason: string
}) {
  const { access } = await requirePlatformBillingAccess()
  const planKey = assertPlanKey(input.planKey)
  const reason = assertReason(input.reason)
  const name = input.name.trim()
  if (!name || name.length > 80) throw new Error("Plan name is invalid.")
  const numericValues = [input.monthlyPriceUsdCents, input.restaurantLimit, input.userLimit]
  if (numericValues.some((value) => !Number.isInteger(value) || value < 0) || input.restaurantLimit < 1 || input.userLimit < 1) throw new Error("Plan limits are invalid.")
  if (input.reservationLimit !== null && (!Number.isInteger(input.reservationLimit) || input.reservationLimit < 1)) throw new Error("Reservation limit is invalid.")
  if (input.historyDays !== null && (!Number.isInteger(input.historyDays) || input.historyDays < 1)) throw new Error("History limit is invalid.")
  const features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, Boolean(input.features?.[key])]))
  const service = db()
  const { data: before, error: readError } = await service.from("plans").select("key, name, monthly_price_usd_cents, restaurant_limit, user_limit, reservation_limit, history_days, features, active").eq("key", planKey).single()
  if (readError || !before) throw new Error(readError?.message || "Plan not found.")
  const { data: after, error } = await service.from("plans").update({ name, monthly_price_usd_cents: input.monthlyPriceUsdCents, restaurant_limit: input.restaurantLimit, user_limit: input.userLimit, reservation_limit: input.reservationLimit, history_days: input.historyDays, features }).eq("key", planKey).select("key, name, monthly_price_usd_cents, restaurant_limit, user_limit, reservation_limit, history_days, features, active").single()
  if (error || !after) throw new Error(error?.message || "Plan could not be updated.")
  await audit({ actorUserId: access.userId, action: "plan.update", entityType: "plan", entityId: planKey, before, after, reason })
  return { success: true, data: after }
}

export async function updatePlatformSetting(key: string, value: unknown, reason: string) {
  const { access } = await requirePlatformWriteAccess()
  if (!SETTINGS.includes(key as PlatformSettingKey)) throw new Error("Unsupported platform setting.")
  const normalizedReason = assertReason(reason)
  if (typeof value === "string" && value.length > 1000) throw new Error("Setting value is too long.")
  const service = db()
  const { data: before } = await service.from("platform_settings").select("key, value").eq("key", key).maybeSingle()
  const { data: after, error } = await service.from("platform_settings").upsert({ key, value, updated_by: access.userId }, { onConflict: "key" }).select("key, value, updated_by, updated_at").single()
  if (error || !after) throw new Error(error?.message || "Platform setting could not be updated.")
  await audit({ actorUserId: access.userId, action: "setting.update", entityType: "platform_setting", entityId: key, before: before || {}, after, reason: normalizedReason })
  return { success: true, data: after }
}

export async function updatePlatformMember(input: { userId: string; role: string; status: "active" | "suspended"; reason: string }) {
  const { access } = await requirePlatformOwner()
  assertUuid(input.userId, "User ID")
  if (!isPlatformRole(input.role)) throw new Error("Invalid platform role.")
  const reason = assertReason(input.reason)
  const service = db()
  const { data: before, error: readError } = await service.from("platform_members").select("user_id, role, status").eq("user_id", input.userId).maybeSingle()
  if (readError) throw new Error(readError.message)
  if (input.userId === access.userId && input.status === "suspended") throw new Error("You cannot suspend your own platform access.")
  if (before?.role === "platform_owner" && input.role !== "platform_owner") {
    const { count, error } = await service.from("platform_members").select("user_id", { count: "exact", head: true }).eq("role", "platform_owner").eq("status", "active")
    if (error) throw new Error(error.message)
    if ((count || 0) <= 1) throw new Error("The last active platform owner cannot be demoted.")
  }
  const { data: after, error } = await service.from("platform_members").upsert({ user_id: input.userId, role: input.role, status: input.status, created_by: before ? undefined : access.userId }, { onConflict: "user_id" }).select("user_id, role, status").single()
  if (error || !after) throw new Error(error?.message || "Platform member could not be updated.")
  await audit({ actorUserId: access.userId, action: "platform_member.update", entityType: "platform_member", entityId: input.userId, before: before || {}, after, reason })
  return { success: true, data: after }
}

export type PlatformRestaurantCreateInput = {
  name: string
  businessContactEmail: string
  officialWebsiteUrl: string
  officialDomain?: string
  slug?: string
  description?: string
  cuisine?: string
  location?: string
  phone?: string
  address_line1?: string | null
  address_line2?: string | null
  address_locality?: string | null
  address_region?: string | null
  address_postal_code?: string | null
  address_country?: string | null
  latitude?: number | null
  longitude?: number | null
  hours?: string
  atmosphere?: string
  timezone?: string
  language?: string
  reservation_enabled?: boolean
  opening_time?: string
  closing_time?: string
  time_slot_duration?: number
  advance_booking_days?: number
  min_advance_hours?: number
  min_party_size?: number
  max_party_size?: number
  meal_only_reservations?: boolean
  allowed_days_of_week?: number[]
  logoUrl?: string | null
  primaryImageUrl?: string | null
  socialLinks?: RestaurantSocialLinks | null
  menuUrl?: string | null
  locationUrl?: string | null
  eventsUrl?: string | null
}

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0
}

export function validatePlatformRestaurantProfileInput(input: PlatformRestaurantCreateInput) {
  const name = input.name.trim()
  const description = input.description?.trim() || ""
  if (wordCount(name) > 3) throw new Error("Restaurant name must be 3 words or fewer.")
  if (wordCount(description) > 15) throw new Error("Description must be 15 words or fewer.")

  const socialError = validateSocialLinks(input.socialLinks)
  if (socialError) throw new Error(socialError)
  const socialLinks = normalizeSocialLinks(input.socialLinks)
  const socialCount = Object.entries(socialLinks).filter(([platform, value]) => platform !== "website" && Boolean(value)).length
  if (socialCount > 4) throw new Error("Add no more than 4 social links.")
  for (const [value, label] of [[input.menuUrl, "Menu URL"], [input.locationUrl, "Location URL"], [input.eventsUrl, "Events URL"]] as const) {
    const urlError = validateOptionalPublicUrl(value, label)
    if (urlError) throw new Error(urlError)
  }

  if (input.allowed_days_of_week && (input.allowed_days_of_week.length === 0 || input.allowed_days_of_week.some((day) => !Number.isInteger(day) || day < 1 || day > 7))) {
    throw new Error("Choose at least one valid reservation day.")
  }
  if (input.time_slot_duration !== undefined && (!Number.isInteger(input.time_slot_duration) || input.time_slot_duration < 5 || input.time_slot_duration > 240)) throw new Error("Time slot duration must be between 5 and 240 minutes.")
  if (input.advance_booking_days !== undefined && (!Number.isInteger(input.advance_booking_days) || input.advance_booking_days < 1 || input.advance_booking_days > 365)) throw new Error("Advance booking days must be between 1 and 365.")
  if (input.min_advance_hours !== undefined && (!Number.isInteger(input.min_advance_hours) || input.min_advance_hours < 0 || input.min_advance_hours > 720)) throw new Error("Minimum advance notice must be between 0 and 720 hours.")
  if (input.min_party_size !== undefined && (!Number.isInteger(input.min_party_size) || input.min_party_size < 1 || input.min_party_size > 100)) throw new Error("Minimum party size must be between 1 and 100.")
  if (input.max_party_size !== undefined && (!Number.isInteger(input.max_party_size) || input.max_party_size < 1 || input.max_party_size > 100)) throw new Error("Maximum party size must be between 1 and 100.")
  if (input.min_party_size !== undefined && input.max_party_size !== undefined && input.max_party_size < input.min_party_size) throw new Error("Maximum party size cannot be smaller than minimum party size.")
  if ((input.latitude == null) !== (input.longitude == null)) throw new Error("Latitude and longitude must be provided together.")
  if (input.latitude != null && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)) throw new Error("Latitude must be between -90 and 90.")
  if (input.longitude != null && (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180)) throw new Error("Longitude must be between -180 and 180.")
  return { socialLinks }
}

function assertPlatformRestaurantContact(input: PlatformRestaurantCreateInput) {
  const name = input.name.trim()
  const email = normalizeBusinessEmail(input.businessContactEmail)
  const website = normalizeOfficialWebsiteUrl(input.officialWebsiteUrl)
  const profile = validatePlatformRestaurantProfileInput(input)
  if (!name) throw new Error("Restaurant name is required.")
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid business contact email is required.")
  if (!website) throw new Error("A valid official website URL is required.")
  if (input.slug?.trim() && validateRestaurantSlug(input.slug.trim())) throw new Error(validateRestaurantSlug(input.slug.trim()) || "Public slug is invalid.")
  return { name, email, website, domain: normalizeOfficialDomain(input.officialDomain || website), socialLinks: { ...profile.socialLinks, website } }
}

export async function previewPlatformRestaurantWebsite(input: { websiteUrl: string }): Promise<WebsiteImportResult> {
  await requirePlatformWriteAccess()
  const website = normalizeOfficialWebsiteUrl(input.websiteUrl)
  if (!website) throw new Error("A valid official website URL is required.")
  return importRestaurantFromWebsite(website, { maxDiscoveryPages: 5 })
}

async function resolvePlatformRestaurantSlug(service: PlatformDb, requestedSlug: string | undefined, restaurantName: string) {
  const requested = requestedSlug?.trim().toLowerCase() || ""
  const baseSlug = requested || slugifyRestaurantName(restaurantName)
  const slugError = validateRestaurantSlug(baseSlug)
  if (slugError && requested) throw new Error(slugError)

  const { data, error } = await service.from("restaurants").select("slug").limit(10000)
  if (error) throw new Error(error.message)
  const usedSlugs = new Set((data || []).map((row: { slug: string }) => row.slug))
  let candidate = baseSlug
  let suffix = 2
  while (usedSlugs.has(candidate) || Boolean(validateRestaurantSlug(candidate))) {
    candidate = appendRestaurantSlugSuffix(baseSlug, suffix)
    suffix += 1
  }
  return candidate
}

export async function createPlatformRestaurant(input: PlatformRestaurantCreateInput) {
  const access = await requirePlatformWriteAccess()
  const normalized = assertPlatformRestaurantContact(input)
  const service = db()
  const { data: duplicateEmail, error: duplicateError } = await service
    .from("restaurant_claim_profiles")
    .select("restaurant_id")
    .eq("normalized_business_contact_email", normalized.email)
    .in("ownership_status", ["unclaimed", "claim_pending"])
    .limit(1)
  if (duplicateError) throw new Error(duplicateError.message)
  if (duplicateEmail?.length) throw new Error("That business contact email already belongs to another claimable restaurant.")

  let restaurantSlug = await resolvePlatformRestaurantSlug(service, input.slug, normalized.name)
  let provisioned: Awaited<ReturnType<typeof provisionRestaurantWorkspace>> | null = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      provisioned = await provisionRestaurantWorkspace({
        restaurantName: normalized.name,
        workspaceName: `${normalized.name} workspace`,
        restaurantSlug,
        restaurantStatus: "published",
        ownershipStatus: "unclaimed",
        source: "platform_manual",
        businessContactEmail: normalized.email,
        officialWebsiteUrl: normalized.website,
        officialDomain: normalized.domain,
        description: input.description,
        cuisine: input.cuisine,
        location: input.location,
        phone: input.phone,
        addressLine1: input.address_line1,
        addressLine2: input.address_line2,
        addressLocality: input.address_locality,
        addressRegion: input.address_region,
        addressPostalCode: input.address_postal_code,
        addressCountry: input.address_country,
        latitude: input.latitude,
        longitude: input.longitude,
        hours: input.hours,
        atmosphere: input.atmosphere,
        timezone: input.timezone,
        language: input.language,
        reservation_enabled: input.reservation_enabled,
        opening_time: input.opening_time,
        closing_time: input.closing_time,
        time_slot_duration: input.time_slot_duration,
        advance_booking_days: input.advance_booking_days,
        min_advance_hours: input.min_advance_hours,
        min_party_size: input.min_party_size,
        max_party_size: input.max_party_size,
        meal_only_reservations: input.meal_only_reservations,
        allowed_days_of_week: input.allowed_days_of_week,
      })
      break
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "SLUG_CONFLICT" || attempt === 2) throw error
      restaurantSlug = await resolvePlatformRestaurantSlug(service, restaurantSlug, normalized.name)
    }
  }
  if (!provisioned) throw new Error("Restaurant provisioning returned no tenant identifiers.")
  const { error: profileLinksError } = await service.from("restaurants").update({
    social_links: normalized.socialLinks,
    menu_url: input.menuUrl?.trim() || null,
    location_url: input.locationUrl?.trim() || null,
    events_url: input.eventsUrl?.trim() || null,
  }).eq("id", provisioned.restaurant_id)
  if (profileLinksError) throw new Error(profileLinksError.message)
  await audit({
    actorUserId: access.access.userId,
    action: "restaurant.claimable_manual_create",
    entityType: "restaurant",
    entityId: provisioned.restaurant_id,
    after: { restaurantId: provisioned.restaurant_id, workspaceId: provisioned.workspace_id, source: "platform_manual", ownershipStatus: "unclaimed" },
    metadata: { officialDomain: normalized.domain, hasBusinessContactEmail: true },
  })
  let websiteAssets: WebsiteAssetSyncResult | null = null
  try {
    websiteAssets = await syncRestaurantWebsiteAssets({
      restaurantId: provisioned.restaurant_id,
      workspaceId: provisioned.workspace_id,
      officialWebsiteUrl: normalized.website,
      preferredLogoUrl: input.logoUrl,
      preferredPrimaryUrl: input.primaryImageUrl,
    })
    if (websiteAssets.logo.status === "imported" || websiteAssets.primary.status === "imported") {
      await audit({
        actorUserId: access.access.userId,
        action: "restaurant.website_assets_imported",
        entityType: "restaurant",
        entityId: provisioned.restaurant_id,
        after: { logo: websiteAssets.logo.status, primary: websiteAssets.primary.status },
        metadata: { source: "official_website" },
      })
    }
  } catch (error) {
    websiteAssets = {
      success: false,
      sourceUrl: normalized.website,
      logo: { status: "failed", url: null, message: error instanceof Error ? error.message : "Logo import failed." },
      primary: { status: "failed", url: null, message: error instanceof Error ? error.message : "Banner import failed." },
      message: error instanceof Error ? error.message : "Website assets could not be imported.",
    }
  }
  return {
    success: true as const,
    restaurantId: provisioned.restaurant_id,
    workspaceId: provisioned.workspace_id,
    slug: provisioned.restaurant_slug,
    publicUrl: await getRestaurantPublicUrl({ id: provisioned.restaurant_id, slug: provisioned.restaurant_slug, workspaceId: provisioned.workspace_id }),
    businessContactEmail: normalized.email,
    officialDomain: normalized.domain,
    ownershipStatus: "unclaimed" as const,
    source: "platform_manual" as const,
    websiteAssets,
  }
}

export async function syncPlatformRestaurantWebsiteAssets(restaurantIds: string[]) {
  const access = await requirePlatformWriteAccess()
  const ids = Array.from(new Set(restaurantIds.filter((id) => UUID_PATTERN.test(id)))).slice(0, 500)
  type WebsiteSyncResult = { restaurantId: string; name: string; result: WebsiteAssetSyncResult | null; enrichment?: RestaurantWebsiteEnrichmentResult | null; message?: string }
  if (ids.length === 0) return { success: true as const, results: [] as WebsiteSyncResult[] }
  const service = db()
  const [{ data: restaurants, error: restaurantError }, { data: profiles, error: profileError }] = await Promise.all([
    service.from("restaurants").select("id, name, workspace_id").in("id", ids),
    service.from("restaurant_claim_profiles").select("restaurant_id, source, official_website_url").in("restaurant_id", ids),
  ])
  if (restaurantError) throw new Error(restaurantError.message)
  if (profileError) throw new Error(profileError.message)
  const profileByRestaurant = new Map((profiles || []).map((profile: any) => [profile.restaurant_id, profile]))
  const results: WebsiteSyncResult[] = []
  for (const restaurant of restaurants || []) {
    const claimProfile = profileByRestaurant.get(restaurant.id)
    const website = claimProfile?.official_website_url
    if (!restaurant.workspace_id || !website) {
      results.push({ restaurantId: restaurant.id, name: restaurant.name, result: null, message: "No official website is configured." })
      continue
    }
    try {
      const shouldEnrichProfile = claimProfile?.source === "platform_manual" || claimProfile?.source === "platform_excel"
      const synced = shouldEnrichProfile
        ? await syncRestaurantWebsiteProfile({ restaurantId: restaurant.id, workspaceId: restaurant.workspace_id, officialWebsiteUrl: website })
        : { assets: await syncRestaurantWebsiteAssets({ restaurantId: restaurant.id, workspaceId: restaurant.workspace_id, officialWebsiteUrl: website }), enrichment: null }
      const result = synced.assets
      results.push({ restaurantId: restaurant.id, name: restaurant.name, result, enrichment: synced.enrichment })
      if (result.logo.status === "imported" || result.primary.status === "imported") {
        await audit({
          actorUserId: access.access.userId,
          action: "restaurant.website_assets_imported",
          entityType: "restaurant",
          entityId: restaurant.id,
          after: { logo: result.logo.status, primary: result.primary.status },
          metadata: { source: "official_website" },
        })
      }
      if (synced.enrichment?.updatedFields.length) {
        await audit({
          actorUserId: access.access.userId,
          action: "restaurant.website_profile_enriched",
          entityType: "restaurant",
          entityId: restaurant.id,
          after: { updatedFields: synced.enrichment.updatedFields, skippedFields: synced.enrichment.skippedFields },
          metadata: { source: "official_website" },
        })
      }
    } catch (error) {
      results.push({ restaurantId: restaurant.id, name: restaurant.name, result: null, message: error instanceof Error ? error.message : "Website assets could not be imported." })
    }
  }
  return { success: true as const, results }
}

export async function getPlatformRestaurantDetail(restaurantId: string) {
  await requirePlatformRole()
  if (!UUID_PATTERN.test(restaurantId)) return null
  const service = db()
  const [{ data: restaurant, error: restaurantError }, { data: claimProfile, error: claimError }, { data: auditRows, error: auditError }, { count: reservationCount, error: reservationError }] = await Promise.all([
    service.from("restaurants").select("id, name, slug, logo_url, primary_image_url, status, platform_status, workspace_id, reservation_enabled, created_at, updated_at, description, cuisine, location, phone, hours, atmosphere, timezone, language, opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, min_party_size, max_party_size, meal_only_reservations, address_line1, address_line2, address_locality, address_region, address_postal_code, address_country, latitude, longitude, official_website_url").eq("id", restaurantId).maybeSingle(),
    service.from("restaurant_claim_profiles").select("restaurant_id, ownership_status, source, business_contact_email, official_website_url, official_domain, claimed_by_user_id, claimed_at, source_import_id, created_at, updated_at").eq("restaurant_id", restaurantId).maybeSingle(),
    service.from("platform_audit_logs").select("id, actor_user_id, action, entity_type, entity_id, reason, metadata, created_at").eq("entity_type", "restaurant").eq("entity_id", restaurantId).order("created_at", { ascending: false }).limit(20),
    service.from("reservations").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId),
  ])
  if (restaurantError) throw new Error(restaurantError.message)
  if (claimError) throw new Error(claimError.message)
  if (auditError) throw new Error(auditError.message)
  if (reservationError) throw new Error(reservationError.message)
  if (!restaurant) return null
  const { data: workspace, error: workspaceError } = restaurant.workspace_id
    ? await service.from("workspaces").select("id, name, slug, status, platform_status, created_at").eq("id", restaurant.workspace_id).maybeSingle()
    : { data: null, error: null }
  if (workspaceError) throw new Error(workspaceError.message)
  const { data: claimedBy } = claimProfile?.claimed_by_user_id
    ? await service.auth.admin.getUserById(claimProfile.claimed_by_user_id)
    : { data: null }
  return {
    restaurant,
    workspace,
    claimProfile,
    claimedByEmail: claimedBy?.user?.email || null,
    reservationCount: reservationCount || 0,
    publicUrl: await getRestaurantPublicUrl({ id: restaurant.id, slug: restaurant.slug, workspaceId: restaurant.workspace_id }),
    aiReadiness: getRestaurantAiReadiness(restaurant),
    audit: auditRows || [],
  }
}

export type PlatformRestaurantImportTarget = {
  id: string
  name: string
  slug: string
  workspace_id: string
}

type ResolvedRestaurantImportRow = ParsedRestaurantImportRow & {
  targetRestaurantId?: string
  matchMethod?: "public_slug" | "business_email"
  matchName?: string
}

export function resolveRestaurantImportTargets(
  rows: ParsedRestaurantImportRow[],
  restaurants: PlatformRestaurantImportTarget[],
  profiles: Array<{ restaurant_id: string; source: string; normalized_business_contact_email: string | null }>,
) {
  const sourceByRestaurantId = new Map(profiles.map((profile) => [profile.restaurant_id, profile.source]))
  const updateTargets = restaurants.filter((restaurant) => ["platform_manual", "platform_excel"].includes(sourceByRestaurantId.get(restaurant.id) || ""))
  const bySlug = new Map(updateTargets.map((restaurant) => [restaurant.slug.toLowerCase(), restaurant]))
  const byEmail = new Map<string, PlatformRestaurantImportTarget[]>()
  for (const profile of profiles) {
    if (!profile.normalized_business_contact_email) continue
    const target = updateTargets.find((restaurant) => restaurant.id === profile.restaurant_id)
    if (!target) continue
    const current = byEmail.get(profile.normalized_business_contact_email) || []
    current.push(target)
    byEmail.set(profile.normalized_business_contact_email, current)
  }

  const resolvedRows: ResolvedRestaurantImportRow[] = rows.map((row) => {
    if (row.status === "error") return { ...row, targetRestaurantId: undefined, matchMethod: undefined, matchName: undefined }
    const messages = [...row.messages]
    const slugTarget = row.payload.slug ? bySlug.get(row.payload.slug.toLowerCase()) : undefined
    const emailTargets = byEmail.get(row.payload.business_contact_email) || []
    let target = slugTarget
    let matchMethod: "public_slug" | "business_email" | null = slugTarget ? "public_slug" : null

    if (!target && emailTargets.length === 1) {
      target = emailTargets[0]
      matchMethod = "business_email"
      if (row.payload.slug && target.slug !== row.payload.slug) {
        messages.push("Public slug differs from the existing restaurant; its existing slug will be preserved.")
      }
    } else if (!target && emailTargets.length > 1) {
      messages.push("Business email matches more than one platform restaurant.")
    } else if (target && emailTargets.some((candidate) => candidate.id !== target?.id)) {
      messages.push("Business email belongs to a different platform restaurant.")
    }

    if (!target && !messages.some((message) => message.includes("matches more than one") || message.includes("belongs to a different"))) {
      messages.push("No existing platform restaurant matched by public slug or business email.")
    }

    const hasHardError = messages.some((message) => (
      message.includes("matches more than one") ||
      message.includes("belongs to a different") ||
      message.includes("No existing platform restaurant")
    ))
    return {
      ...row,
      targetRestaurantId: hasHardError ? undefined : target?.id,
      matchMethod: hasHardError ? undefined : matchMethod || undefined,
      matchName: hasHardError ? undefined : target?.name,
      messages,
      status: hasHardError ? "error" as const : messages.length > 0 ? "warning" as const : row.status,
    }
  })

  const targetCounts = new Map<string, number>()
  for (const row of resolvedRows) {
    if (row.targetRestaurantId) targetCounts.set(row.targetRestaurantId, (targetCounts.get(row.targetRestaurantId) || 0) + 1)
  }
  return resolvedRows.map((row) => {
    if (!row.targetRestaurantId || (targetCounts.get(row.targetRestaurantId) || 0) < 2) return row
    const messages = [...row.messages, "Multiple workbook rows match the same existing restaurant."]
    return { ...row, targetRestaurantId: undefined, matchMethod: undefined, matchName: undefined, messages, status: "error" as const }
  })
}

export async function previewPlatformRestaurantImport(input: { filename: string; buffer: Buffer; mode?: PlatformRestaurantImportMode }) {
  const access = await requirePlatformWriteAccess()
  if (!/\.xlsx$/i.test(input.filename)) throw new Error("Only .xlsx files are accepted.")
  const mode = input.mode === "update" ? "update" : "create"
  const service = db()
  const [{ data: restaurants, error: restaurantError }, { data: profiles, error: profileError }] = await Promise.all([
    service.from("restaurants").select("id, name, slug, workspace_id"),
    service.from("restaurant_claim_profiles").select("restaurant_id, source, normalized_business_contact_email").limit(10000),
  ])
  if (restaurantError) throw new Error(restaurantError.message)
  if (profileError) throw new Error(profileError.message)
  const rows = await parseRestaurantImportFile(input.buffer, mode === "create" ? {
    existingSlugs: new Set((restaurants || []).map((row: any) => row.slug)),
    existingBusinessEmails: new Set((profiles || []).map((row: any) => row.normalized_business_contact_email).filter(Boolean)),
  } : { mode })
  const resolvedRows: ResolvedRestaurantImportRow[] = mode === "update"
    ? resolveRestaurantImportTargets(rows, restaurants || [], profiles || [])
    : rows.map((row) => ({ ...row, targetRestaurantId: undefined, matchMethod: undefined, matchName: undefined }))
  const importRow = {
    actor_user_id: access.access.userId,
    original_filename: input.filename.trim().slice(0, 255),
    mode,
    total_rows: resolvedRows.length,
    ready_rows: resolvedRows.filter((row) => row.status !== "error").length,
    warning_rows: resolvedRows.filter((row) => row.status === "warning").length,
    invalid_rows: resolvedRows.filter((row) => row.status === "error").length,
    status: "preview",
    summary: { source: "xlsx", mode, maxRows: 500 },
  }
  const { data: batch, error: batchError } = await service.from("platform_restaurant_imports").insert(importRow).select("id, original_filename, mode, total_rows, ready_rows, warning_rows, invalid_rows, status, created_at").single()
  if (batchError || !batch) throw new Error(batchError?.message || "Import batch could not be created.")
  const { error: rowsError } = await service.from("platform_restaurant_import_rows").insert(resolvedRows.map((row) => ({
    import_id: batch.id,
    excel_row_number: row.excelRowNumber,
    normalized_payload: { ...row.payload, __provided_fields: row.providedFields },
    validation_status: row.status,
    validation_messages: row.messages,
    restaurant_id: row.targetRestaurantId || null,
  })))
  if (rowsError) throw new Error(rowsError.message)
  await audit({ actorUserId: access.access.userId, action: "restaurant.import_created", entityType: "restaurant_import", entityId: batch.id, after: { mode, totalRows: resolvedRows.length, readyRows: importRow.ready_rows, invalidRows: importRow.invalid_rows }, metadata: { filename: input.filename } })
  return { batch, rows: resolvedRows }
}

export async function confirmPlatformRestaurantImport(batchId: string) {
  const access = await requirePlatformWriteAccess()
  assertUuid(batchId, "Import batch ID")
  const service = db()
  const { data: batch, error: batchError } = await service.from("platform_restaurant_imports").select("id, original_filename, mode, status, total_rows, ready_rows, warning_rows, invalid_rows, created_rows, updated_rows, failed_rows, processing_started_at, updated_at").eq("id", batchId).single()
  if (batchError || !batch) throw new Error(batchError?.message || "Import batch not found.")
  if (batch.status === "completed") return { success: true as const, batch, rows: [] }
  if (batch.status === "confirming" && batch.processing_started_at && Date.now() - new Date(batch.processing_started_at).getTime() < 15 * 60 * 1000) {
    throw new Error("This import is already being processed. Refresh the page for its result.")
  }
  let lockQuery = service
    .from("platform_restaurant_imports")
    .update({ status: "confirming", processing_started_at: new Date().toISOString() })
    .eq("id", batchId)
  if (batch.status === "preview") {
    lockQuery = lockQuery.eq("status", "preview")
  } else {
    lockQuery = lockQuery.eq("status", "confirming").eq("processing_started_at", batch.processing_started_at)
  }
  const { data: lock, error: lockError } = await lockQuery.select("id").maybeSingle()
  if (lockError || !lock) throw new Error(lockError?.message || "This import is already being processed.")
  const { data: rows, error: rowsError } = await service.from("platform_restaurant_import_rows").select("id, excel_row_number, normalized_payload, validation_status, row_status, restaurant_id, failure_reason").eq("import_id", batchId).order("excel_row_number", { ascending: true })
  if (rowsError) throw new Error(rowsError.message)
  let created = Number(batch.created_rows || 0)
  let updated = Number(batch.updated_rows || 0)
  let failed = Number(batch.failed_rows || 0)
  const resultRows: Array<Record<string, unknown>> = []
  for (const row of rows || []) {
    if (!["pending", "processing"].includes(row.row_status)) {
      resultRows.push(row)
      continue
    }
    const { data: claimedRow, error: claimRowError } = await service
      .from("platform_restaurant_import_rows")
      .update({ row_status: "processing" })
      .eq("id", row.id)
      .in("row_status", ["pending", "processing"])
      .select("id, excel_row_number, normalized_payload, validation_status, row_status, restaurant_id, failure_reason")
      .maybeSingle()
    if (claimRowError) throw new Error(claimRowError.message)
    if (!claimedRow) continue
    if (row.validation_status === "error") {
      await service.from("platform_restaurant_import_rows").update({ row_status: "failed", failure_reason: "Validation error" }).eq("id", row.id).eq("row_status", "processing")
      failed += 1
      resultRows.push({ ...row, row_status: "failed", failure_reason: "Validation error" })
      continue
    }
    const snapshot = claimedRow.normalized_payload as RestaurantImportPayload & { __provided_fields?: string[] }
    const { __provided_fields: providedFields = [], ...payload } = snapshot
    try {
      if (batch.mode === "update") {
        if (!claimedRow.restaurant_id) throw new Error("The row has no matched restaurant.")
        const { data: updatedRestaurant, error: updateError } = await service.rpc("update_platform_restaurant_from_import", {
          target_restaurant_id: claimedRow.restaurant_id,
          target_payload: payload,
          target_provided_fields: providedFields,
        })
        if (updateError) throw new Error(updateError.message)
        const target = Array.isArray(updatedRestaurant) ? updatedRestaurant[0] : updatedRestaurant
        if (!target?.restaurant_id || target.restaurant_id !== claimedRow.restaurant_id) throw new Error("Restaurant update returned no target.")
        await service.from("platform_restaurant_import_rows").update({ row_status: "updated", failure_reason: null }).eq("id", row.id)
        updated += 1
        const publicUrl = await getRestaurantPublicUrl({ id: target.restaurant_id, slug: target.restaurant_slug, workspaceId: target.workspace_id })
        resultRows.push({ ...row, row_status: "updated", restaurant_id: target.restaurant_id, publicUrl, detailUrl: "/platform/restaurants/" + target.restaurant_id })
        await audit({ actorUserId: access.access.userId, action: "restaurant.updated_from_import", entityType: "restaurant", entityId: target.restaurant_id, after: { importId: batchId, mode: "update" }, metadata: { importRowId: row.id, excelRowNumber: row.excel_row_number } })
      } else {
        const provisioned = await provisionRestaurantWorkspace({
          restaurantName: payload.name,
          workspaceName: payload.name + " workspace",
          restaurantSlug: payload.slug,
          restaurantStatus: "published",
          ownershipStatus: "unclaimed",
          source: "platform_excel",
          businessContactEmail: payload.business_contact_email,
          officialWebsiteUrl: payload.official_website_url,
          officialDomain: payload.official_domain,
          sourceImportId: batchId,
          ...payload,
        })
        await service.from("platform_restaurant_import_rows").update({ row_status: "created", restaurant_id: provisioned.restaurant_id, failure_reason: null }).eq("id", row.id)
        created += 1
        const publicUrl = await getRestaurantPublicUrl({ id: provisioned.restaurant_id, slug: provisioned.restaurant_slug, workspaceId: provisioned.workspace_id })
        resultRows.push({ ...row, row_status: "created", restaurant_id: provisioned.restaurant_id, publicUrl, detailUrl: "/platform/restaurants/" + provisioned.restaurant_id })
        await audit({ actorUserId: access.access.userId, action: "restaurant.imported", entityType: "restaurant", entityId: provisioned.restaurant_id, after: { source: "platform_excel", importId: batchId, ownershipStatus: "unclaimed" }, metadata: { importRowId: row.id, excelRowNumber: row.excel_row_number } })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Import row failed."
      if (batch.mode === "update") {
        await service.from("platform_restaurant_import_rows").update({ row_status: "failed", failure_reason: reason }).eq("id", row.id)
        failed += 1
        resultRows.push({ ...row, row_status: "failed", failure_reason: reason })
        continue
      }
      const existing = await service.from("restaurants").select("id, workspace_id, slug, name").eq("slug", payload.slug).maybeSingle()
      const recoveredProfile = existing.data
        ? await service.from("restaurant_claim_profiles").select("restaurant_id, source_import_id, normalized_business_contact_email").eq("restaurant_id", existing.data.id).eq("source_import_id", batchId).eq("normalized_business_contact_email", payload.business_contact_email).maybeSingle()
        : { data: null }
      if (existing.data && recoveredProfile.data) {
        await service.from("platform_restaurant_import_rows").update({ row_status: "created", restaurant_id: existing.data.id, failure_reason: null }).eq("id", row.id)
        created += 1
        const publicUrl = await getRestaurantPublicUrl({ id: existing.data.id, slug: existing.data.slug, workspaceId: existing.data.workspace_id })
        resultRows.push({ ...row, row_status: "created", restaurant_id: existing.data.id, publicUrl, detailUrl: "/platform/restaurants/" + existing.data.id })
      } else {
        await service.from("platform_restaurant_import_rows").update({ row_status: "failed", failure_reason: reason }).eq("id", row.id)
        failed += 1
        resultRows.push({ ...row, row_status: "failed", failure_reason: reason })
      }
    }
  }
  const { data: countRows, error: countRowsError } = await service
    .from("platform_restaurant_import_rows")
    .select("row_status")
    .eq("import_id", batchId)
  if (countRowsError) throw new Error(countRowsError.message)
  created = (countRows || []).filter((row: any) => row.row_status === "created").length
  updated = (countRows || []).filter((row: any) => row.row_status === "updated").length
  failed = (countRows || []).filter((row: any) => row.row_status === "failed").length
  const processed = created + updated
  const finalStatus = failed > 0 ? (processed > 0 ? "partial" : "failed") : "completed"
  const { data: finalBatch, error: finalBatchError } = await service.from("platform_restaurant_imports").update({ status: finalStatus, processing_started_at: null, created_rows: created, updated_rows: updated, failed_rows: failed, completed_at: new Date().toISOString(), summary: { mode: batch.mode, created, updated, failed, invalid: batch.invalid_rows } }).eq("id", batchId).select("id, original_filename, mode, status, total_rows, ready_rows, warning_rows, invalid_rows, created_rows, updated_rows, failed_rows, completed_at").single()
  if (finalBatchError) throw new Error(finalBatchError.message)
  await audit({ actorUserId: access.access.userId, action: "restaurant.import_completed", entityType: "restaurant_import", entityId: batchId, after: { status: finalStatus, mode: batch.mode, createdRows: created, updatedRows: updated, failedRows: failed } })
  return { success: true as const, batch: finalBatch, rows: resultRows }
}

export async function listPlatformRestaurantClaims() {
  await requirePlatformRole()
  const service = db()
  const { data: claims, error } = await service.from("restaurant_claims").select("id, restaurant_id, claimant_user_id, requested_email, verified_email, verification_method, status, expires_at, approved_at, created_at, metadata").in("status", ["pending", "verified", "approved"]).order("created_at", { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  const restaurantIds = Array.from(new Set((claims || []).map((claim: any) => claim.restaurant_id)))
  const [{ data: restaurants, error: restaurantError }, userResults] = await Promise.all([
    restaurantIds.length ? service.from("restaurants").select("id, name, slug, workspace_id").in("id", restaurantIds) : Promise.resolve({ data: [], error: null }),
    Promise.all(Array.from(new Set((claims || []).map((claim: any) => claim.claimant_user_id).filter(Boolean))).map(async (userId) => ({ userId, result: await service.auth.admin.getUserById(userId) }))),
  ])
  if (restaurantError) throw new Error(restaurantError.message)
  const restaurantById = new Map((restaurants || []).map((restaurant: any) => [restaurant.id, restaurant]))
  const userById = new Map((userResults || []).map((item: any) => [item.userId, item.result.data?.user?.email || null]))
  return (claims || []).map((claim: any) => ({ ...claim, restaurant: restaurantById.get(claim.restaurant_id) || null, claimantEmail: userById.get(claim.claimant_user_id) || null }))
}

export async function approvePlatformRestaurantClaim(claimId: string, reason: string) {
  const access = await requirePlatformWriteAccess()
  assertUuid(claimId, "Claim ID")
  const service = db()
  const { data: claim, error } = await service.from("restaurant_claims").select("id, restaurant_id, claimant_user_id, status").eq("id", claimId).single()
  if (error || !claim) throw new Error(error?.message || "Claim request not found.")
  if (!claim.claimant_user_id) throw new Error("A signed-in claimant is required before manual approval.")
  if (claim.status === "consumed") return { success: true as const, alreadyComplete: true }
  const userResult = await service.auth.admin.getUserById(claim.claimant_user_id)
  if (userResult.error || !userResult.data.user?.email_confirmed_at) throw new Error("The claimant email must be verified before approval.")
  const { error: completionError } = await service.rpc("complete_restaurant_claim", { target_restaurant_id: claim.restaurant_id, target_user_id: claim.claimant_user_id, target_verified_email: userResult.data.user.email || "", target_verification_method: "manual_review" } as any)
  if (completionError) throw new Error(completionError.message)
  await audit({ actorUserId: access.access.userId, action: "restaurant.claim_manually_approved", entityType: "restaurant_claim", entityId: claimId, after: { restaurantId: claim.restaurant_id, status: "consumed" }, reason: reason.trim() || null })
  return { success: true as const, alreadyComplete: false }
}

export async function rejectPlatformRestaurantClaim(claimId: string, reason: string) {
  const access = await requirePlatformWriteAccess()
  assertUuid(claimId, "Claim ID")
  if (reason.trim().length < 3) throw new Error("A rejection reason is required.")
  const service = db()
  const { data: claim, error } = await service.from("restaurant_claims").update({ status: "rejected", rejected_by_user_id: access.access.userId, rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", claimId).in("status", ["pending", "verified", "approved"]).select("id, restaurant_id, status").maybeSingle()
  if (error || !claim) throw new Error(error?.message || "Claim request is no longer actionable.")
  const { count: activeRequests, error: activeRequestError } = await service
    .from("restaurant_claims")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", claim.restaurant_id)
    .in("status", ["pending", "verified", "approved"])
  if (activeRequestError) throw new Error(activeRequestError.message)
  if ((activeRequests || 0) === 0) {
    const { error: profileError } = await service
      .from("restaurant_claim_profiles")
      .update({ ownership_status: "unclaimed" })
      .eq("restaurant_id", claim.restaurant_id)
      .eq("ownership_status", "claim_pending")
    if (profileError) throw new Error(profileError.message)
  }
  await audit({ actorUserId: access.access.userId, action: "restaurant.claim_rejected", entityType: "restaurant_claim", entityId: claimId, after: { restaurantId: claim.restaurant_id, status: "rejected" }, reason: reason.trim() })
  return { success: true as const }
}
