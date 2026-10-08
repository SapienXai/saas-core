import "server-only"
import { cache } from "react"
import { getManagementContext } from "@/lib/management-context"
import { buildEffectivePwaBranding, getGenericPwaBranding } from "@/lib/pwa"
import type { ManageInitialContext } from "@/context/manage-context"

export const getManagementLayoutData = cache(async function getManagementLayoutData() {
  const context = await getManagementContext()
  if (!context?.currentWorkspace?.id) return { context, branding: getGenericPwaBranding() }

  const { data: settings } = await (await import("@/lib/supabase")).createServiceRoleClient().from("workspace_pwa_settings").select("app_name, icon_url, theme_color, background_color").eq("workspace_id", context.currentWorkspace.id).maybeSingle()
  const branding = buildEffectivePwaBranding({
    workspaceId: context.currentWorkspace.id,
    workspaceName: context.currentWorkspace.workspace?.name,
    settings,
    customBrandingEnabled: context.currentWorkspace.customPwaEnabled,
  })
  return { context, branding }
})

export function toInitialContext(context: Awaited<ReturnType<typeof getManagementContext>>): ManageInitialContext | null {
  if (!context) return null
  return { user: { id: context.access.userId, email: context.access.email, name: context.access.name }, role: context.access.role, platformRole: context.access.platformRole, isSuperAdmin: context.access.isSuperAdmin, memberships: context.memberships, currentWorkspace: context.currentWorkspace, ownedWorkspaceId: context.ownedWorkspaceId, canCreateWorkspace: context.canCreateWorkspace, planCatalog: context.planCatalog }
}
