import { NextResponse } from "next/server"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { getManagementContext } from "@/lib/management-context"

export async function GET() {
  try {
    const access = await getCurrentUserAccess()
    if (!access) return NextResponse.json({ ok: true, role: null })
    const context = await getManagementContext()
    return NextResponse.json({
      ok: true,
      user: {
        id: access.userId,
        email: access.email || "",
        name: access.name || "",
      },
      role: access.role,
      platformRole: access.platformRole,
      isSuperAdmin: access.isSuperAdmin,
      memberships: context?.memberships || [],
      currentWorkspace: context?.currentWorkspace || null,
      ownedWorkspaceId: context?.ownedWorkspaceId || null,
      restaurants: context?.restaurants || [],
      activeRestaurantId: context?.activeRestaurantId || null,
      canCreateWorkspace: context?.canCreateWorkspace ?? false,
    })
  } catch {
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 })
  }
}
