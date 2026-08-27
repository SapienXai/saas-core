import "server-only"

import { cookies } from "next/headers"
import { getCurrentUserAccess, getPreferredWorkspaceId, getWorkspaceMemberships } from "@/lib/auth-utils"
import { getHostedBrandUrl } from "@/lib/domains/public-url"
import { getWorkspaceEntitlements } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import { cache } from "react"

export const ACTIVE_RESTAURANT_COOKIE = "reservevia_restaurant_id"

export const getManagementContext = cache(async function getManagementContext() {
  const access = await getCurrentUserAccess()
  if (!access) return null
  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available || memberships.memberships.length === 0) {
    return { access, memberships: [], currentWorkspace: null, ownedWorkspaceId: null, restaurants: [], activeRestaurantId: null, canCreateWorkspace: true }
  }

  const preferredId = await getPreferredWorkspaceId()
  const currentWorkspace = memberships.memberships.find((membership) => membership.workspace_id === preferredId) || memberships.memberships[0]
  const service = createServiceRoleClient()
  const [restaurantResult, assignmentResult, entitlements, ownWorkspaceResult] = await Promise.all([
    service
      .from("restaurants")
      .select("id, name, slug, status, workspace_id, meal_only_reservations, logo_url, primary_image_url, updated_at")
      .eq("workspace_id", currentWorkspace.workspace_id)
      .order("name", { ascending: true }),
    currentWorkspace.restaurant_access_mode === "selected"
      ? service
        .from("workspace_member_restaurants")
        .select("restaurant_id")
        .eq("member_id", currentWorkspace.id)
      : Promise.resolve({ data: [] as Array<{ restaurant_id: string }>, error: null }),
    getWorkspaceEntitlements(currentWorkspace.workspace_id).catch(() => null),
    service.from("workspaces").select("id").eq("created_by", access.userId).maybeSingle(),
  ])
  const allRestaurants = restaurantResult.data || []
  const canAccessAllRestaurants = ["owner", "admin"].includes(currentWorkspace.role) || currentWorkspace.restaurant_access_mode === "all"
  const assignedRestaurantIds = new Set((assignmentResult.data || []).map((assignment) => assignment.restaurant_id))
  const restaurants = canAccessAllRestaurants
    ? allRestaurants
    : allRestaurants.filter((restaurant) => assignedRestaurantIds.has(restaurant.id))
  const cookieStore = await cookies()
  const requestedRestaurantId = cookieStore.get(ACTIVE_RESTAURANT_COOKIE)?.value || null
  const activeRestaurantId = requestedRestaurantId === "all" ? null : restaurants?.some((restaurant) => restaurant.id === requestedRestaurantId)
    ? requestedRestaurantId
    : restaurants?.[0]?.id || null
  const workspaceProfile = Array.isArray(currentWorkspace.workspaces) ? currentWorkspace.workspaces[0] : currentWorkspace.workspaces

  return {
    access,
    memberships: memberships.memberships.map((membership) => ({
      id: membership.id,
      workspaceId: membership.workspace_id,
      role: membership.role,
      workspace: Array.isArray(membership.workspaces) ? membership.workspaces[0] : membership.workspaces,
    })),
    currentWorkspace: {
      id: currentWorkspace.workspace_id,
      role: currentWorkspace.role,
      accessMode: currentWorkspace.restaurant_access_mode,
      publicBrandUrl: workspaceProfile?.slug ? getHostedBrandUrl(workspaceProfile.slug) : null,
      workspace: workspaceProfile,
      plan: entitlements
        ? {
            key: entitlements.planKey,
            name: entitlements.planName,
            monthlyPriceUsdCents: entitlements.monthlyPriceUsdCents,
            features: {
              multiRestaurant: entitlements.features.multiRestaurant,
            },
            limits: {
              restaurants: entitlements.limits.restaurants,
              users: entitlements.limits.users,
              reservationsPerPeriod: entitlements.limits.reservationsPerPeriod,
            },
            scheduledPlan: entitlements.scheduledPlan
              ? {
                  key: entitlements.scheduledPlan.key,
                  name: entitlements.scheduledPlan.name,
                  effectiveAt: entitlements.scheduledPlan.effectiveAt,
                  limits: {
                    restaurants: entitlements.scheduledPlan.limits.restaurants,
                    users: entitlements.scheduledPlan.limits.users,
                    reservationsPerPeriod: entitlements.scheduledPlan.limits.reservationsPerPeriod,
                  },
                }
              : null,
            restaurantCount: allRestaurants.length,
          }
        : null,
      customPwaEnabled: Boolean(entitlements?.features.customPWA),
      pushNotificationsEnabled: Boolean(entitlements?.features.pushNotifications),
      // Usage is loaded after the management shell is visible. It is not
      // required to authorize or render the requested page.
      usage: null,
    },
    ownedWorkspaceId: ownWorkspaceResult.data?.id || null,
    restaurants,
    activeRestaurantId,
    canCreateWorkspace: !ownWorkspaceResult.data,
  }
})
