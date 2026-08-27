import "server-only"

import { getPreferredWorkspaceId, getWorkspaceMemberships } from "@/lib/auth-utils"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export type AccountState =
  | { authenticated: false; path: "/login" }
  | {
      authenticated: true
      path: "/onboarding" | "/manage"
      userId: string
      workspaceId: string | null
      restaurantId: string | null
      restaurantSlug: string | null
      workspaceSlug: string | null
      onboardingComplete: boolean
    }

export async function getAccountState(): Promise<AccountState> {
  const authClient = await createSupabaseServerClient()
  const { data, error } = await authClient.auth.getUser()
  if (error || !data.user) return { authenticated: false, path: "/login" }

  const service = createServiceRoleClient()
  const memberships = await getWorkspaceMemberships(data.user.id)
  const preferredWorkspaceId = await getPreferredWorkspaceId()
  const preferredMembership = memberships.memberships.find((membership) => membership.workspace_id === preferredWorkspaceId)
  if (preferredMembership) {
    const [workspaceResult, restaurantResult] = await Promise.all([
      service
        .from("workspaces")
        .select("id, slug, created_by, onboarding_completed_at, status")
        .eq("id", preferredMembership.workspace_id)
        .maybeSingle(),
      service
        .from("restaurants")
        .select("id, slug, status")
        .eq("workspace_id", preferredMembership.workspace_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])
    const preferredWorkspace = workspaceResult.data
    const preferredRestaurant = restaurantResult.data
    const isOwnWorkspace = preferredWorkspace?.created_by === data.user.id
    const onboardingComplete = Boolean(preferredWorkspace?.onboarding_completed_at && preferredRestaurant?.status === "published")
    return {
      authenticated: true,
      path: isOwnWorkspace && !onboardingComplete ? "/onboarding" : "/manage",
      userId: data.user.id,
      workspaceId: preferredWorkspace?.id || preferredMembership.workspace_id,
      restaurantId: preferredRestaurant?.id || null,
      restaurantSlug: preferredRestaurant?.slug || null,
      workspaceSlug: preferredWorkspace?.slug || null,
      onboardingComplete: isOwnWorkspace ? onboardingComplete : true,
    }
  }
  const { data: ownWorkspace } = await service
    .from("workspaces")
    .select("id, slug, onboarding_completed_at, status")
    .eq("created_by", data.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (ownWorkspace) {
    const { data: restaurant } = await service
      .from("restaurants")
      .select("id, slug, status")
      .eq("workspace_id", ownWorkspace.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    const onboardingComplete = Boolean(
      ownWorkspace.onboarding_completed_at && restaurant?.status === "published",
    )

    return {
      authenticated: true,
      path: onboardingComplete ? "/manage" : "/onboarding",
      userId: data.user.id,
      workspaceId: ownWorkspace.id,
      restaurantId: restaurant?.id || null,
      restaurantSlug: restaurant?.slug || null,
      workspaceSlug: ownWorkspace.slug,
      onboardingComplete,
    }
  }

  // Existing inherited/invited users may have memberships without being the
  // self-service creator. They should keep entering management as before.
  if (memberships.memberships.length > 0) {
    const membership = memberships.memberships[0]
    const { data: restaurant } = await service
      .from("restaurants")
      .select("id, slug")
      .eq("workspace_id", membership.workspace_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    return {
      authenticated: true,
      path: "/manage",
      userId: data.user.id,
      workspaceId: membership.workspace_id,
      restaurantId: restaurant?.id || null,
      restaurantSlug: restaurant?.slug || null,
      workspaceSlug: null,
      onboardingComplete: true,
    }
  }

  return {
    authenticated: true,
    path: "/onboarding",
    userId: data.user.id,
    workspaceId: null,
    restaurantId: null,
    restaurantSlug: null,
    workspaceSlug: null,
    onboardingComplete: false,
  }
}

export function safeInternalRedirect(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback
  if (["/login", "/signup", "/forgot-password", "/reset-password", "/manage/login"].includes(value)) return fallback
  return value
}
