import "server-only"
import { getCurrentUserAccess, getPreferredWorkspaceId, getWorkspaceMemberships } from "@/lib/auth-utils"
import { getWorkspaceEntitlements } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import { cache } from "react"

export const getManagementContext = cache(async function getManagementContext() {
  const access = await getCurrentUserAccess(); if (!access) return null
  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.memberships.length) return { access, memberships: [], currentWorkspace: null, ownedWorkspaceId: null, canCreateWorkspace: true }
  const preferred = await getPreferredWorkspaceId(); const selected = memberships.memberships.find((item) => item.workspace_id === preferred) || memberships.memberships[0]; const service = createServiceRoleClient() as any
  const [entitlements, own, usage] = await Promise.all([
    getWorkspaceEntitlements(selected.workspace_id).catch(() => null),
    service.from("workspaces").select("id").eq("created_by", access.userId).maybeSingle(),
    service.from("workspace_usage_periods").select("activity_count, period_start, period_end").eq("workspace_id", selected.workspace_id).order("period_start", { ascending: false }).limit(1).maybeSingle(),
  ])
  const workspaceProfile = Array.isArray(selected.workspaces) ? selected.workspaces[0] : selected.workspaces
  return {
    access,
    memberships: memberships.memberships.map((item) => ({ id: item.id, workspaceId: item.workspace_id, role: item.role, workspace: Array.isArray(item.workspaces) ? item.workspaces[0] : item.workspaces })),
    currentWorkspace: { id: selected.workspace_id, role: selected.role, workspace: workspaceProfile, plan: entitlements ? { key: entitlements.planKey, name: entitlements.planName, monthlyPriceUsdCents: entitlements.monthlyPriceUsdCents, features: entitlements.features, limits: entitlements.limits, scheduledPlan: entitlements.scheduledPlan ? { key: entitlements.scheduledPlan.key, name: entitlements.scheduledPlan.name, effectiveAt: entitlements.scheduledPlan.effectiveAt, limits: entitlements.scheduledPlan.limits } : null } : null, customPwaEnabled: Boolean(entitlements?.features.customPWA), pushNotificationsEnabled: Boolean(entitlements?.features.pushNotifications), usage: usage.data ? { workspaces: 1, users: 0, activity: usage.data.activity_count || 0, periodStart: usage.data.period_start, periodEnd: usage.data.period_end } : null },
    ownedWorkspaceId: own.data?.id || null,
    canCreateWorkspace: !own.data,
  }
})
