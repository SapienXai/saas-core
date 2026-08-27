import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { cache } from "react"
import { isPlatformRole, type PlatformRole } from "@/lib/platform-types"

export type LegacyRole = "admin" | "manager" | "staff" | "readonly"

export interface UserAccess {
  userId: string
  /** Auth/profile identity used by the management shell user card. */
  email?: string | null
  name?: string | null
  restaurantId: string | null
  /** Legacy profile role retained for compatibility with existing UI payloads. */
  role: string
  /** Authoritative role after the workspace membership bridge is available. */
  workspaceRole: string | null
  workspaceAvailable: boolean
  /** Authoritative platform staff role. Never inferred from workspace ownership. */
  platformRole: PlatformRole | null
  isSuperAdmin: boolean
}

export type WorkspaceMembership = {
  id: string
  workspace_id: string
  user_id: string
  role: string
  restaurant_access_mode: "all" | "selected"
  workspaces?: { id: string; name: string; slug: string; status: string } | { id: string; name: string; slug: string; status: string }[] | null
}

export type RestaurantScope =
  | { type: "all" }
  | { type: "one"; id: string }
  | { type: "many"; ids: string[] }
  | { type: "deny" }

export function isReadonlyRole(role?: string | null): boolean {
  return role === "readonly"
}

export function canWrite(access: UserAccess | null): boolean {
  if (!access) return false
  if (access.workspaceAvailable) return Boolean(access.workspaceRole && !isReadonlyRole(access.workspaceRole))
  return !isReadonlyRole(access.role)
}

export function canManageWorkspaceUsers(access: UserAccess | null): boolean {
  if (!access) return false
  const role = access.workspaceAvailable ? access.workspaceRole : access.role
  return role === "owner" || role === "admin"
}

function isWorkspaceSchemaUnavailable(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = error?.message?.toLowerCase() || ""
  return error?.code === "42P01" ||
    error?.code === "42703" ||
    message.includes("workspace_members") ||
    message.includes("workspaces") ||
    message.includes("workspace_id")
}

function isPlatformSchemaUnavailable(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = error?.message?.toLowerCase() || ""
  return error?.code === "42P01" || error?.code === "42703" || message.includes("platform_members") || message.includes("platform_user_controls")
}

async function getPlatformMember(userId: string) {
  const supabase = createServiceRoleClient() as any
  const { data, error } = await supabase
    .from("platform_members")
    .select("user_id, role, status, created_by, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    if (!isPlatformSchemaUnavailable(error)) console.error("Error resolving platform membership:", error)
    return { available: !isPlatformSchemaUnavailable(error), member: null as { role: PlatformRole; status: "active" | "suspended" } | null }
  }

  return {
    available: true,
    member: data && isPlatformRole(data.role)
      ? { role: data.role, status: data.status === "suspended" ? "suspended" : "active" }
      : null,
  }
}

async function getPlatformUserControl(userId: string) {
  const supabase = createServiceRoleClient() as any
  const { data, error } = await supabase
    .from("platform_user_controls")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    if (!isPlatformSchemaUnavailable(error)) console.error("Error resolving platform user control:", error)
    return null
  }
  return data?.status === "suspended" ? "suspended" : "active"
}

async function ensurePlatformOwnerBootstrap(userId: string, email: string | null | undefined, memberExists: boolean) {
  const configuredEmail = process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase()
  if (memberExists || !configuredEmail || !email || email.trim().toLowerCase() !== configuredEmail) return false

  const supabase = createServiceRoleClient() as any
  const { error } = await supabase.from("platform_members").upsert({
    user_id: userId,
    role: "platform_owner",
    status: "active",
    created_by: userId,
  }, { onConflict: "user_id", ignoreDuplicates: true })
  if (error) {
    if (!isPlatformSchemaUnavailable(error)) console.error("Error bootstrapping platform owner:", error)
    return false
  }
  return true
}

export const getWorkspaceMemberships = cache(async function getWorkspaceMemberships(userId: string) {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("workspace_members")
    .select("id, workspace_id, user_id, role, restaurant_access_mode, created_at, workspaces!inner(id, name, slug, status)")
    .eq("user_id", userId)
    .eq("workspaces.status", "active")
    .order("created_at", { ascending: true })

  if (error) {
    if (isWorkspaceSchemaUnavailable(error)) {
      return { available: false, memberships: [] as WorkspaceMembership[] }
    }
    console.error("Error resolving workspace memberships:", error)
    return { available: true, memberships: [] as WorkspaceMembership[] }
  }

  return {
    available: true,
    memberships: (data || []).map((membership) => ({
      ...membership,
      restaurant_access_mode: membership.restaurant_access_mode === "selected" ? "selected" : "all",
    })) as WorkspaceMembership[],
  }
})

export const getPreferredWorkspaceId = cache(async function getPreferredWorkspaceId() {
  try {
    const cookieStore = await cookies()
    return cookieStore.get("reservevia_workspace_id")?.value || null
  } catch {
    return null
  }
})

/**
 * Read the current user through the official Supabase SSR client and preserve
 * the restaurant-scoped compatibility data used by the existing management UI.
 * Workspace membership is resolved by the centralized authorization helpers.
 */
export const getCurrentUserAccess = cache(async function getCurrentUserAccess(): Promise<UserAccess | null> {
  try {
    const authClient = await createSupabaseServerClient()
    const { data: authData, error: authError } = await authClient.auth.getUser()
    if (authError || !authData.user) return null
    const userId = authData.user.id

    const [userControl, initialPlatformMembership, profileResult, memberships] = await Promise.all([
      getPlatformUserControl(userId),
      getPlatformMember(userId),
      createServiceRoleClient()
        .from("admin_profiles")
        .select("restaurant_id, role, full_name")
        .eq("id", userId)
        .maybeSingle(),
      getWorkspaceMemberships(userId),
    ])
    if (userControl === "suspended") return null

    let platformMembership = initialPlatformMembership
    if (platformMembership.available && !platformMembership.member) {
      const bootstrapped = await ensurePlatformOwnerBootstrap(userId, authData.user.email, false)
      if (bootstrapped) platformMembership = await getPlatformMember(userId)
    }
    const platformRole = platformMembership.member?.status === "active" ? platformMembership.member.role : null

    const { data: profile } = profileResult
    const profileName = typeof profile?.full_name === "string" ? profile.full_name.trim() : ""
    const metadataName = typeof authData.user.user_metadata?.full_name === "string" ? authData.user.user_metadata.full_name.trim() : ""
    const preferredWorkspaceId = await getPreferredWorkspaceId()
    const preferredMembership = memberships.memberships.find((membership) => membership.workspace_id === preferredWorkspaceId)
    const workspaceRole = memberships.available ? (preferredMembership || memberships.memberships[0])?.role || null : null
    if (!profile && !workspaceRole && !platformRole) return null

    const legacyRole = memberships.available && memberships.memberships.length > 0
      ? (workspaceRole === "owner" || workspaceRole === "admin" ? "admin" : workspaceRole || "staff")
      : profile?.role || "staff"

    return {
      userId,
      email: authData.user.email?.trim() || "",
      name: profileName || metadataName || "",
      restaurantId: profile?.restaurant_id || null,
      role: legacyRole,
      workspaceRole,
      workspaceAvailable: memberships.available,
      platformRole,
      // Backwards-compatible alias for legacy setup tooling. Workspace owners
      // and admins are not platform super admins anymore.
      isSuperAdmin: platformRole === "platform_owner",
    }
  } catch (error) {
    console.error("Error resolving user access:", error)
    return null
  }
})

/** Check if current user may access a restaurant id. */
export async function hasRestaurantAccess(restaurantId: string): Promise<boolean> {
  const access = await getCurrentUserAccess()
  if (!access) return false

  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available) {
    if (access.isSuperAdmin || access.role === "manager") return true
    return access.restaurantId === restaurantId
  }

  if (memberships.memberships.length === 0) return false

  const { data: restaurant, error } = await createServiceRoleClient()
    .from("restaurants")
    .select("id, workspace_id")
    .eq("id", restaurantId)
    .maybeSingle()

  if (error || !restaurant) return false
  const membership = memberships.memberships.find((item) => item.workspace_id === restaurant.workspace_id)
  if (!membership) return false
  if (["owner", "admin"].includes(membership.role) || membership.restaurant_access_mode === "all") return true
  if (membership.restaurant_access_mode !== "selected") return false

  const { data: assignment } = await createServiceRoleClient()
    .from("workspace_member_restaurants")
    .select("restaurant_id")
    .eq("member_id", memberships.memberships.find((item) => item.workspace_id === restaurant.workspace_id)?.id || "")
    .eq("restaurant_id", restaurantId)
    .maybeSingle()
  return Boolean(assignment)
}

/**
 * Return all restaurant IDs authorized for the current user.
 * null is retained only for the pre-workspace legacy super-admin fallback.
 */
export const getUserRestaurantIds = cache(async function getUserRestaurantIds(targetWorkspaceId?: string): Promise<string[] | null> {
  const access = await getCurrentUserAccess()
  if (!access) return []

  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available) {
    if (access.isSuperAdmin || access.role === "manager") return null
    return access.restaurantId ? [access.restaurantId] : []
  }

  if (memberships.memberships.length === 0) return []

  const preferredWorkspaceId = targetWorkspaceId || await getPreferredWorkspaceId()
  const preferredMemberships = preferredWorkspaceId
    ? memberships.memberships.filter((item) => item.workspace_id === preferredWorkspaceId)
    : []
  const selectedMemberships = preferredMemberships.length > 0
    ? preferredMemberships
    : memberships.memberships
  const workspaceIds = Array.from(new Set(selectedMemberships.map((item) => item.workspace_id)))
  const supabase = createServiceRoleClient()
  const [restaurantResult, assignmentResult] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id, workspace_id")
      .in("workspace_id", workspaceIds),
    (() => {
      const selectedMemberIds = selectedMemberships
        .filter((membership) => membership.restaurant_access_mode === "selected")
        .map((membership) => membership.id)
        .filter((id): id is string => Boolean(id))
      return selectedMemberIds.length > 0
        ? supabase.from("workspace_member_restaurants").select("member_id, restaurant_id").in("member_id", selectedMemberIds)
        : Promise.resolve({ data: [] as Array<{ member_id: string; restaurant_id: string }>, error: null })
    })(),
  ])

  const { data: restaurants, error } = restaurantResult

  if (error) {
    console.error("Error resolving workspace restaurant scope:", error)
    return []
  }

  const allowedIds = new Set<string>()
  const assignments = assignmentResult.data || []

  for (const membership of selectedMemberships) {
    const workspaceRestaurantIds = (restaurants || [])
      .filter((restaurant) => restaurant.workspace_id === membership.workspace_id)
      .map((restaurant) => restaurant.id)

    if (["owner", "admin"].includes(membership.role) || membership.restaurant_access_mode === "all") {
      workspaceRestaurantIds.forEach((id) => allowedIds.add(id))
    } else {
      for (const assignment of assignments || []) {
        if (assignment.member_id === membership.id && workspaceRestaurantIds.includes(assignment.restaurant_id)) {
          allowedIds.add(assignment.restaurant_id)
        }
      }
    }
  }

  return Array.from(allowedIds)
})

/**
 * Coerce an optional requested restaurant ID into an authorized query scope.
 * A multi-restaurant workspace is represented explicitly as many; callers
 * must use .in("restaurant_id", scope.ids) rather than treating it as global.
 */
export async function coerceRestaurantFilter(requested?: string, workspaceId?: string): Promise<RestaurantScope> {
  const allowed = await getUserRestaurantIds(workspaceId)
  let effectiveRequested = requested
  if (!effectiveRequested) {
    try {
      const cookieStore = await cookies()
      const preferredRestaurant = cookieStore.get("reservevia_restaurant_id")?.value
      if (preferredRestaurant && preferredRestaurant !== "all") effectiveRequested = preferredRestaurant
    } catch {
      // Background/server-only callers can use the complete allowed scope.
    }
  }
  if (allowed === null) {
    return (effectiveRequested && effectiveRequested !== "all") ? { type: "one", id: effectiveRequested } : { type: "all" }
  }

  if (allowed.length === 0) return { type: "deny" }
  if (effectiveRequested && effectiveRequested !== "all") {
    return allowed.includes(effectiveRequested) ? { type: "one", id: effectiveRequested } : { type: "deny" }
  }
  if (allowed.length === 1) return { type: "one", id: allowed[0] }
  return { type: "many", ids: allowed }
}

export function scopeContainsRestaurant(scope: RestaurantScope, restaurantId: string | null | undefined) {
  if (!restaurantId || scope.type === "deny") return false
  if (scope.type === "all") return true
  if (scope.type === "one") return scope.id === restaurantId
  return scope.ids.includes(restaurantId)
}
