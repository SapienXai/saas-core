import "server-only"
import { getCurrentUserAccess, getPreferredWorkspaceId, getWorkspaceMemberships } from "@/lib/auth-utils"
import { getWorkspaceEntitlements, getWorkspaceUsage } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import { cache } from "react"

export const getManagementContext = cache(async function getManagementContext() {
  const access = await getCurrentUserAccess(); if (!access) return null
  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.memberships.length) return { access, memberships: [], currentWorkspace: null, planCatalog: [], ownedWorkspaceId: null, canCreateWorkspace: true }
  const preferred = await getPreferredWorkspaceId(); const selected = memberships.memberships.find((item) => item.workspace_id === preferred) || memberships.memberships[0]; const service = createServiceRoleClient() as any
  const [entitlements, own, usage, catalog] = await Promise.all([
    getWorkspaceEntitlements(selected.workspace_id).catch(() => null),
    service.from("workspace_members").select("workspace_id").eq("user_id", access.userId).eq("role", "owner").order("created_at", { ascending: true }),
    getWorkspaceUsage(selected.workspace_id).catch(() => null),
    service.from("plans").select("key, name, sort_order, limits, metadata").eq("active", true).order("sort_order", { ascending: true }).order("key", { ascending: true }),
  ])
  const workspaceProfile = Array.isArray(selected.workspaces) ? selected.workspaces[0] : selected.workspaces
  const ownedWorkspaceCount = own.data?.length || 0
  const hasWorkspaceLimit = Boolean(entitlements && Object.prototype.hasOwnProperty.call(entitlements.limits, "core.workspaces"))
  const workspaceLimit = hasWorkspaceLimit ? entitlements?.limits["core.workspaces"] : undefined
  return {
    access,
    memberships: memberships.memberships.map((item) => ({ id: item.id, workspaceId: item.workspace_id, role: item.role, workspace: Array.isArray(item.workspaces) ? item.workspaces[0] : item.workspaces })),
    currentWorkspace: { id: selected.workspace_id, role: selected.role, workspace: workspaceProfile, plan: entitlements ? { key: entitlements.planKey, name: entitlements.planName, pricing: entitlements.pricing, features: entitlements.features, limits: entitlements.limits, scheduledPlan: entitlements.scheduledPlan ? { key: entitlements.scheduledPlan.key, name: entitlements.scheduledPlan.name, effectiveAt: entitlements.scheduledPlan.effectiveAt, limits: entitlements.scheduledPlan.limits } : null } : null, customPwaEnabled: Boolean(entitlements?.features.customPWA), pushNotificationsEnabled: Boolean(entitlements?.features.pushNotifications), usage: usage ? { workspaces: usage.workspaces, users: usage.users, metrics: usage.metrics, periodStart: usage.periodStart, periodEnd: usage.periodEnd } : null },
    planCatalog: (catalog.data || []).map((plan: any) => ({ key: plan.key, name: plan.name, sortOrder: plan.sort_order, limits: plan.limits || {}, metadata: plan.metadata || {} })),
    ownedWorkspaceId: own.data?.[0]?.workspace_id || null,
    canCreateWorkspace: workspaceLimit === null || typeof workspaceLimit === "number" && ownedWorkspaceCount < workspaceLimit,
  }
})
