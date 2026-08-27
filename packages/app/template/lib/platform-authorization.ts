import { AuthorizationError, requireUser } from "@/lib/authorization"
import { PLATFORM_ROLES, platformRoleAllows, type PlatformRole } from "@/lib/platform-types"

export { PLATFORM_ROLES }
export type { PlatformRole }

export const PLATFORM_READ_ROLES = PLATFORM_ROLES
export const PLATFORM_WRITE_ROLES = ["platform_owner", "platform_admin"] as const satisfies readonly PlatformRole[]
export const PLATFORM_BILLING_ROLES = ["platform_owner", "billing_admin"] as const satisfies readonly PlatformRole[]

export async function requirePlatformRole(allowedRoles: readonly PlatformRole[] = PLATFORM_READ_ROLES) {
  const access = await requireUser()
  if (!platformRoleAllows(access.platformRole, allowedRoles)) {
    throw new AuthorizationError("FORBIDDEN", "You do not have permission for this platform action.")
  }
  return { access, role: access.platformRole as PlatformRole }
}

export function canReadPlatform(role: PlatformRole | null | undefined) {
  return platformRoleAllows(role, PLATFORM_READ_ROLES)
}

export function canWritePlatform(role: PlatformRole | null | undefined) {
  return platformRoleAllows(role, PLATFORM_WRITE_ROLES)
}

export function canManageBilling(role: PlatformRole | null | undefined) {
  return platformRoleAllows(role, PLATFORM_BILLING_ROLES)
}

export async function requirePlatformWriteAccess() {
  return requirePlatformRole(PLATFORM_WRITE_ROLES)
}

export async function requirePlatformBillingAccess() {
  return requirePlatformRole(PLATFORM_BILLING_ROLES)
}

export async function requirePlatformOwner() {
  return requirePlatformRole(["platform_owner"])
}
