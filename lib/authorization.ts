import {
  getCurrentUserAccess,
  getWorkspaceMemberships,
  getPreferredWorkspaceId,
  type UserAccess,
} from "@/lib/auth-utils"
import { createServiceRoleClient } from "@/lib/supabase"

export const WORKSPACE_ROLES = ["owner", "admin", "manager", "staff", "readonly"] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export class AuthorizationError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND"

  constructor(code: AuthorizationError["code"], message: string) {
    super(message)
    this.name = "AuthorizationError"
    this.code = code
  }
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && WORKSPACE_ROLES.includes(value as WorkspaceRole)
}

export function roleAllows(role: string | null | undefined, allowedRoles: readonly WorkspaceRole[]) {
  return Boolean(role && allowedRoles.includes(role as WorkspaceRole))
}

export type RestaurantAccessDecision = {
  membershipRole: WorkspaceRole | null
  restaurantAccessMode?: "all" | "selected"
  assignedRestaurantIds?: string[]
  profileRestaurantId: string | null
  restaurantId: string
}

/** Pure decision helper used by the application and tenant-isolation tests. */
export function canAccessRestaurant(decision: RestaurantAccessDecision) {
  if (!decision.membershipRole) return false
  if (["owner", "admin"].includes(decision.membershipRole)) return true
  if (decision.restaurantAccessMode === "all") return true
  if (decision.restaurantAccessMode === "selected") return Boolean(decision.assignedRestaurantIds?.includes(decision.restaurantId))
  return decision.profileRestaurantId === decision.restaurantId
}

export async function requireUser(): Promise<UserAccess> {
  const access = await getCurrentUserAccess()
  if (!access) {
    throw new AuthorizationError("UNAUTHENTICATED", "Authentication is required.")
  }
  return access
}

export async function getCurrentWorkspace() {
  const access = await requireUser()
  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available || memberships.memberships.length === 0) return null
  const preferredWorkspaceId = await getPreferredWorkspaceId()
  return memberships.memberships.find((membership) => membership.workspace_id === preferredWorkspaceId) || memberships.memberships[0]
}

export async function requireWorkspaceAccess(workspaceId: string) {
  const access = await requireUser()
  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available) {
    throw new AuthorizationError("FORBIDDEN", "Workspace authorization is not available yet.")
  }

  const membership = memberships.memberships.find((item) => item.workspace_id === workspaceId)
  if (!membership) {
    throw new AuthorizationError("FORBIDDEN", "You do not have access to this workspace.")
  }
  return { access, membership }
}

export async function requireWorkspaceRole(workspaceId: string, allowedRoles: readonly WorkspaceRole[]) {
  const result = await requireWorkspaceAccess(workspaceId)
  if (!roleAllows(result.membership.role, allowedRoles)) {
    throw new AuthorizationError("FORBIDDEN", "You do not have permission for this workspace action.")
  }
  return result
}

export async function requireWorkspaceCreationAccess(targetWorkspaceId?: string) {
  const access = await requireUser()
  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available) {
    if (access.platformRole !== "platform_owner") {
      throw new AuthorizationError("FORBIDDEN", "You do not have permission to create a restaurant.")
    }
    return { access, workspaceId: null as string | null, membership: null }
  }

  const requestedWorkspaceId = targetWorkspaceId?.trim()
  if (requestedWorkspaceId) {
    const membership = memberships.memberships.find((item) => item.workspace_id === requestedWorkspaceId)
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new AuthorizationError("FORBIDDEN", "You do not have permission to create a restaurant in this workspace.")
    }
    return { access, workspaceId: membership.workspace_id, membership }
  }

  const preferredWorkspaceId = await getPreferredWorkspaceId()
  const membership = memberships.memberships.find((item) => item.workspace_id === preferredWorkspaceId && ["owner", "admin"].includes(item.role))
    || memberships.memberships.find((item) => ["owner", "admin"].includes(item.role))
  if (!membership) {
    throw new AuthorizationError("FORBIDDEN", "You do not have permission to create a restaurant.")
  }
  return { access, workspaceId: membership.workspace_id, membership }
}

export async function getWorkspaceForRestaurant(restaurantId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("restaurants")
    .select("id, name, slug, workspace_id, status")
    .eq("id", restaurantId)
    .maybeSingle()

  if (error || !data) return null
  return data as { id: string; name: string; slug: string; workspace_id: string | null; status: string }
}

export async function requireRestaurantAccess(restaurantId: string) {
  const access = await requireUser()
  const restaurant = await getWorkspaceForRestaurant(restaurantId)
  if (!restaurant) {
    throw new AuthorizationError("NOT_FOUND", "Restaurant not found.")
  }

  if (!restaurant.workspace_id) {
    const legacyAllowed = access.platformRole === "platform_owner" || access.role === "manager" || access.restaurantId === restaurantId
    if (!legacyAllowed) {
      throw new AuthorizationError("FORBIDDEN", "You do not have access to this restaurant.")
    }
    return { access, restaurant, membership: null }
  }

  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available) {
    throw new AuthorizationError("FORBIDDEN", "Workspace authorization is not available yet.")
  }
  const membership = memberships.memberships.find((item) => item.workspace_id === restaurant.workspace_id)
  if (!canAccessRestaurant({
    membershipRole: (membership?.role as WorkspaceRole | null) || null,
    restaurantAccessMode: membership?.restaurant_access_mode,
    assignedRestaurantIds: membership?.restaurant_access_mode === "selected"
      ? (await createServiceRoleClient().from("workspace_member_restaurants").select("restaurant_id").eq("member_id", membership.id)).data?.map((row) => row.restaurant_id)
      : undefined,
    profileRestaurantId: access.restaurantId,
    restaurantId,
  })) {
    throw new AuthorizationError("FORBIDDEN", "You do not have access to this restaurant.")
  }

  return { access, restaurant, membership }
}

export async function requireRestaurantManagementAccess(
  restaurantId: string,
  allowedRoles: readonly WorkspaceRole[] = ["owner", "admin", "manager"]
) {
  const result = await requireRestaurantAccess(restaurantId)
  if (!result.membership) {
    if (result.access.platformRole !== "platform_owner" && !(result.access.role === "manager" && allowedRoles.includes("manager"))) {
      throw new AuthorizationError("FORBIDDEN", "You do not have permission for this restaurant.")
    }
    return result
  }

  if (!roleAllows(result.membership.role, allowedRoles)) {
    throw new AuthorizationError("FORBIDDEN", "You do not have permission for this restaurant.")
  }
  return result
}

export async function requireReservationAccess(reservationId: string) {
  const supabase = createServiceRoleClient()
  const { data: reservation, error } = await supabase
    .from("reservations")
    .select("id, restaurant_id")
    .eq("id", reservationId)
    .maybeSingle()

  if (error || !reservation) {
    throw new AuthorizationError("NOT_FOUND", "Reservation not found.")
  }

  const restaurantAccess = await requireRestaurantAccess(reservation.restaurant_id)
  return { ...restaurantAccess, reservation }
}
