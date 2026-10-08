import { createServiceRoleClient } from "@/lib/supabase"
import { getCurrentUserAccess, getPreferredWorkspaceId, getWorkspaceMemberships, type WorkspaceMembership, type WorkspaceRole } from "@/lib/auth-utils"
import { isProductCapabilityEnabled } from "@/lib/product-config"

export class AuthorizationError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND", message: string) { super(message); this.name = "AuthorizationError" }
}
export function roleAllows(role: string | null | undefined, allowedRoles: readonly WorkspaceRole[]) { return Boolean(role && allowedRoles.includes(role as WorkspaceRole)) }
export async function requireUser() { const access = await getCurrentUserAccess(); if (!access) throw new AuthorizationError("UNAUTHENTICATED", "Please sign in to continue."); return access }
export async function requireProductCapability(capability: string) {
  const access = await requireUser()
  if (!isProductCapabilityEnabled(capability, access.platformRole)) throw new AuthorizationError("FORBIDDEN", "You do not have access to this product capability.")
  return access
}
export async function getCurrentWorkspace() {
  const access = await requireUser(); const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available || !memberships.memberships.length) return null
  const preferred = await getPreferredWorkspaceId(); const membership = memberships.memberships.find((item) => item.workspace_id === preferred) || memberships.memberships[0]
  return { ...membership, access }
}
export async function requireWorkspaceAccess(workspaceId: string) {
  const access = await requireUser(); if (access.platformRole) return { access, membership: null as WorkspaceMembership | null }
  const memberships = await getWorkspaceMemberships(access.userId)
  if (!memberships.available) throw new AuthorizationError("FORBIDDEN", "Workspace authorization is not available yet.")
  const membership = memberships.memberships.find((item) => item.workspace_id === workspaceId)
  if (!membership) throw new AuthorizationError("FORBIDDEN", "You do not have access to this workspace.")
  return { access, membership }
}
export async function requireWorkspaceRole(workspaceId: string, allowedRoles: readonly WorkspaceRole[]) {
  const result = await requireWorkspaceAccess(workspaceId)
  if (result.access.platformRole || roleAllows(result.membership?.role, allowedRoles)) return result
  throw new AuthorizationError("FORBIDDEN", "You do not have permission for this workspace action.")
}
export async function requireWorkspaceCreationAccess(targetWorkspaceId?: string) {
  const access = await requireUser(); const memberships = await getWorkspaceMemberships(access.userId)
  if (access.platformRole === "platform_owner" && (!targetWorkspaceId || !memberships.available)) return { access, workspaceId: targetWorkspaceId || null, membership: null }
  const preferred = await getPreferredWorkspaceId(); const requested = targetWorkspaceId?.trim()
  const candidate = requested ? memberships.memberships.find((item) => item.workspace_id === requested) : memberships.memberships.find((item) => item.workspace_id === preferred && roleAllows(item.role, ["owner", "admin"])) || memberships.memberships.find((item) => roleAllows(item.role, ["owner", "admin"]))
  if (candidate && roleAllows(candidate.role, ["owner", "admin"])) return { access, workspaceId: candidate.workspace_id, membership: candidate }
  if (!requested && !memberships.memberships.length) return { access, workspaceId: null as string | null, membership: null }
  throw new AuthorizationError("FORBIDDEN", "You do not have permission to create a workspace here.")
}
export async function getWorkspaceForAccess(workspaceId: string) {
  const { data, error } = await (createServiceRoleClient() as any).from("workspaces").select("id, name, slug, status, created_by").eq("id", workspaceId).maybeSingle()
  return error || !data ? null : data
}
