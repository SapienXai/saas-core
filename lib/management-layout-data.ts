import "server-only"

import { getManagementContext } from "@/lib/management-context"
import type { ManageInitialContext } from "@/context/manage-context"

export function toInitialContext(context: Awaited<ReturnType<typeof getManagementContext>>): ManageInitialContext | null {
  if (!context) return null
  return {
    user: {
      id: context.access.userId,
      email: context.access.email || "",
      name: context.access.name || "",
    },
    role: context.access.role,
    platformRole: context.access.platformRole,
    isSuperAdmin: context.access.isSuperAdmin,
    memberships: context.memberships,
    currentWorkspace: context.currentWorkspace,
    ownedWorkspaceId: context.ownedWorkspaceId,
    restaurants: context.restaurants,
    activeRestaurantId: context.activeRestaurantId,
    canCreateWorkspace: context.canCreateWorkspace,
  }
}
