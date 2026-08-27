import "server-only"

import { audit } from "@/lib/platform-admin"
import { requirePlatformRole } from "@/lib/platform-authorization"
import { deriveWorkspaceLifecycle, summarizeLifecycle, type WorkspaceLifecycle, type WorkspaceLifecycleSnapshot } from "@/lib/platform-lifecycle"
import { createServiceRoleClient } from "@/lib/supabase"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function db() {
  return createServiceRoleClient() as ReturnType<typeof createServiceRoleClient> & { from(table: string): any }
}

export async function getPlatformSupportView(workspaceId: string, userId?: string) {
  const access = await requirePlatformRole()
  if (!UUID_PATTERN.test(workspaceId)) return null
  if (userId && !UUID_PATTERN.test(userId)) return null
  const service = db()
  const [{ data: workspace, error: workspaceError }, { data: subscription, error: subscriptionError }, { data: overrides, error: overrideError }, { data: plan, error: planError }, { data: restaurants, error: restaurantError }, { data: members, error: memberError }] = await Promise.all([
    service.from("workspaces").select("id, name, slug, status, platform_status, created_at, onboarding_completed_at").eq("id", workspaceId).maybeSingle(),
    service.from("workspace_subscriptions").select("plan_key, status, source, provider, provider_status, current_period_start, current_period_end").eq("workspace_id", workspaceId).maybeSingle(),
    service.from("subscription_overrides").select("id, plan_key, effective_from, effective_until, reason").eq("workspace_id", workspaceId).is("revoked_at", null).order("effective_from", { ascending: false }),
    service.from("plans").select("key, name, monthly_price_usd_cents, restaurant_limit, user_limit, reservation_limit, history_days, features").eq("key", "free").maybeSingle(),
    service.from("restaurants").select("id, name, slug, status, platform_status, reservation_enabled, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    service.from("workspace_members").select("id, user_id, role, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
  ])
  if (workspaceError) throw new Error(workspaceError.message)
  if (!workspace) return null
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (overrideError) throw new Error(overrideError.message)
  if (planError) throw new Error(planError.message)
  if (restaurantError) throw new Error(restaurantError.message)
  if (memberError) throw new Error(memberError.message)
  const activeOverride = (overrides || []).find((override: any) => new Date(override.effective_from).getTime() <= Date.now() && (!override.effective_until || new Date(override.effective_until).getTime() > Date.now()))
  const effectivePlanKey = activeOverride?.plan_key || subscription?.plan_key || "free"
  const { data: effectivePlan, error: effectivePlanError } = await service.from("plans").select("key, name, monthly_price_usd_cents, restaurant_limit, user_limit, reservation_limit, history_days, features").eq("key", effectivePlanKey).maybeSingle()
  if (effectivePlanError) throw new Error(effectivePlanError.message)
  const restaurantIds = (restaurants || []).map((restaurant: any) => restaurant.id)
  const memberIds = (members || []).map((member: any) => member.user_id)
  const [{ data: directory, error: directoryError }, { data: domains, error: domainError }, { data: notifications, error: notificationError }, { data: reservations, error: reservationError }, { data: platformMembers, error: platformMemberError }] = await Promise.all([
    memberIds.length ? service.from("platform_user_directory").select("user_id, email, full_name").in("user_id", memberIds) : Promise.resolve({ data: [], error: null }),
    restaurantIds.length ? service.from("restaurant_domains").select("id, restaurant_id, hostname, status, verification_state, provider_verified, dns_configured").in("restaurant_id", restaurantIds) : Promise.resolve({ data: [], error: null }),
    restaurantIds.length ? service.from("notification_settings").select("restaurant_id, email_notifications, sms_notifications").in("restaurant_id", restaurantIds) : Promise.resolve({ data: [], error: null }),
    restaurantIds.length ? service.from("reservations").select("restaurant_id, created_at").in("restaurant_id", restaurantIds).order("created_at", { ascending: true }).limit(5000) : Promise.resolve({ data: [], error: null }),
    memberIds.length ? service.from("platform_members").select("user_id, role, status").in("user_id", memberIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (directoryError) throw new Error(directoryError.message)
  if (domainError) throw new Error(domainError.message)
  if (notificationError) throw new Error(notificationError.message)
  if (reservationError) throw new Error(reservationError.message)
  if (platformMemberError) throw new Error(platformMemberError.message)
  const directoryById = new Map((directory || []).map((row: any) => [row.user_id, row]))
  const platformMemberById = new Map((platformMembers || []).map((row: any) => [row.user_id, row]))
  const firstReservation = (reservations || []).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]?.created_at || null
  const lifecycleSnapshot: WorkspaceLifecycleSnapshot = { id: workspace.id, createdAt: workspace.created_at, onboardingCompletedAt: workspace.onboarding_completed_at, restaurants: (restaurants || []).map((restaurant: any) => ({ id: restaurant.id, createdAt: restaurant.created_at, status: restaurant.status })), firstReservationAt: firstReservation, planKey: effectivePlanKey, subscriptionStatus: subscription?.status || null }
  const lifecycle = deriveWorkspaceLifecycle(lifecycleSnapshot)
  await audit({ actorUserId: access.access.userId, action: "platform.support.view", entityType: "workspace", entityId: workspace.id, metadata: { selectedUserId: userId || null, mode: "read_only", source: "platform_control" } })
  const selectedMember = userId ? (members || []).find((member: any) => member.user_id === userId) : null
  return {
    workspace,
    selectedUserId: userId || null,
    selectedUser: selectedMember ? { userId: selectedMember.user_id, name: directoryById.get(selectedMember.user_id)?.full_name || null, email: directoryById.get(selectedMember.user_id)?.email || "Unknown email", workspaceRole: selectedMember.role, platformRole: platformMemberById.get(selectedMember.user_id)?.status === "active" ? platformMemberById.get(selectedMember.user_id)?.role || null : null, platformMemberStatus: platformMemberById.get(selectedMember.user_id)?.status || null } : null,
    plan: effectivePlan || plan || { key: effectivePlanKey, name: effectivePlanKey, features: {}, restaurant_limit: null, user_limit: null, reservation_limit: null, history_days: null },
    planKey: effectivePlanKey,
    subscription: subscription || null,
    override: activeOverride || null,
    restaurants: restaurants || [],
    members: (members || []).map((member: any) => ({ userId: member.user_id, role: member.role, name: directoryById.get(member.user_id)?.full_name || null, email: directoryById.get(member.user_id)?.email || "Unknown email" })),
    configuration: { domains: domains || [], notifications: notifications || [], publishedRestaurants: (restaurants || []).filter((restaurant: any) => restaurant.status === "published").length, reservationEnabledRestaurants: (restaurants || []).filter((restaurant: any) => restaurant.reservation_enabled).length },
    customerFacingState: { onboarding: workspace.onboarding_completed_at ? "completed" : "incomplete", platformStatus: workspace.platform_status, published: (restaurants || []).some((restaurant: any) => restaurant.status === "published"), firstReservationAt: firstReservation },
    lifecycle,
  }
}

export async function getPlatformLifecycleSummary() {
  await requirePlatformRole()
  const service = db()
  const [{ data: workspaces, error: workspaceError }, { data: restaurants, error: restaurantError }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
    service.from("workspaces").select("id, created_at, onboarding_completed_at").order("created_at", { ascending: false }).limit(1000),
    service.from("restaurants").select("id, workspace_id, status, created_at").order("created_at", { ascending: true }).limit(5000),
    service.from("workspace_subscriptions").select("workspace_id, plan_key, status"),
  ])
  if (workspaceError) throw new Error(workspaceError.message)
  if (restaurantError) throw new Error(restaurantError.message)
  if (subscriptionError) throw new Error(subscriptionError.message)
  const restaurantRows = restaurants || []
  const restaurantIds = restaurantRows.map((restaurant: any) => restaurant.id)
  const { data: reservations, error: reservationError } = restaurantIds.length ? await service.from("reservations").select("restaurant_id, created_at").in("restaurant_id", restaurantIds).order("created_at", { ascending: true }).limit(10000) : { data: [], error: null }
  if (reservationError) throw new Error(reservationError.message)
  const restaurantById = new Map(restaurantRows.map((restaurant: any) => [restaurant.id, restaurant]))
  const firstReservationByWorkspace = new Map<string, string>()
  for (const reservation of reservations || []) { const workspaceId = restaurantById.get(reservation.restaurant_id)?.workspace_id; if (workspaceId && !firstReservationByWorkspace.has(workspaceId)) firstReservationByWorkspace.set(workspaceId, reservation.created_at) }
  const subscriptionByWorkspace = new Map((subscriptions || []).map((subscription: any) => [subscription.workspace_id, subscription]))
  const lifecycles: Array<WorkspaceLifecycle & { workspaceId: string }> = (workspaces || []).map((workspace: any) => {
    const snapshot: WorkspaceLifecycleSnapshot = { id: workspace.id, createdAt: workspace.created_at, onboardingCompletedAt: workspace.onboarding_completed_at, restaurants: restaurantRows.filter((restaurant: any) => restaurant.workspace_id === workspace.id).map((restaurant: any) => ({ id: restaurant.id, createdAt: restaurant.created_at, status: restaurant.status })), firstReservationAt: firstReservationByWorkspace.get(workspace.id) || null, planKey: subscriptionByWorkspace.get(workspace.id)?.plan_key || "free", subscriptionStatus: subscriptionByWorkspace.get(workspace.id)?.status || null }
    return { workspaceId: workspace.id, ...deriveWorkspaceLifecycle(snapshot) }
  })
  return { counts: summarizeLifecycle(lifecycles), workspaces: lifecycles }
}
