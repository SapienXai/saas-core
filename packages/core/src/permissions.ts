import { CoreError } from "./errors.js"
import type { WorkspaceRole, PlatformRole } from "./types.js"

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "manager", "member", "viewer"]
export const PLATFORM_ROLES: readonly PlatformRole[] = ["platform_owner", "platform_admin", "billing_admin", "support", "auditor"]

export const WORKSPACE_PERMISSIONS = {
  "workspace:read": ["owner", "admin", "manager", "member", "viewer"],
  "workspace:update": ["owner", "admin"],
  "workspace:archive": ["owner"],
  "members:read": ["owner", "admin", "manager"],
  "members:invite": ["owner", "admin"],
  "members:update": ["owner", "admin"],
  "members:remove": ["owner", "admin"],
  "billing:read": ["owner", "admin"],
  "billing:manage": ["owner"],
  "domains:manage": ["owner", "admin"],
  "audit:read": ["owner", "admin"],
} as const satisfies Record<string, readonly WorkspaceRole[]>

export type WorkspacePermission = keyof typeof WORKSPACE_PERMISSIONS | (string & {})

export const PLATFORM_PERMISSIONS = {
  "platform:read": ["platform_owner", "platform_admin", "billing_admin", "support", "auditor"],
  "platform:mutate": ["platform_owner", "platform_admin"],
  "billing:operate": ["platform_owner", "platform_admin", "billing_admin"],
  "support:inspect": ["platform_owner", "platform_admin", "support", "auditor"],
  "support:mutate": ["platform_owner", "platform_admin"],
  "audit:read": ["platform_owner", "platform_admin", "support", "auditor"],
} as const satisfies Record<string, readonly PlatformRole[]>

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS | (string & {})

export function canWorkspaceRole(role: WorkspaceRole | null | undefined, permission: WorkspacePermission, custom: Record<string, readonly WorkspaceRole[]> = {}) {
  if (!role) return false
  const allowed = custom[permission] ?? WORKSPACE_PERMISSIONS[permission as keyof typeof WORKSPACE_PERMISSIONS]
  return Boolean(allowed?.includes(role))
}

export function requireWorkspacePermission(role: WorkspaceRole | null | undefined, permission: WorkspacePermission, custom?: Record<string, readonly WorkspaceRole[]>) {
  if (!canWorkspaceRole(role, permission, custom)) throw new CoreError("FORBIDDEN", "You do not have permission for this workspace action.", { permission })
}

export function canPlatformRole(role: PlatformRole | null | undefined, permission: PlatformPermission, custom: Record<string, readonly PlatformRole[]> = {}) {
  if (!role) return false
  const allowed = custom[permission] ?? PLATFORM_PERMISSIONS[permission as keyof typeof PLATFORM_PERMISSIONS]
  return Boolean(allowed?.includes(role))
}

export function canManageWorkspaceRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (actor === "owner") return target !== "owner"
  if (actor === "admin") return ["manager", "member", "viewer"].includes(target)
  return false
}

export function isWorkspaceOwner(role: WorkspaceRole | null | undefined): role is "owner" {
  return role === "owner"
}
