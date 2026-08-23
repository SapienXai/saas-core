import { CoreError } from "./errors.js"
import { canPlatformRole } from "./permissions.js"
import type { PlatformMember, PlatformRole } from "./types.js"
import type { PlatformPermission } from "./permissions.js"

export function requirePlatformPermission(member: PlatformMember | null, permission: PlatformPermission): PlatformMember {
  if (!member || member.status !== "active" || !canPlatformRole(member.role, permission)) throw new CoreError("FORBIDDEN", "Platform permission is required.", { permission })
  return member
}

export function supportViewIsReadOnly(permission: PlatformPermission, mutation: boolean): boolean {
  return permission === "support:inspect" && mutation
}

export function createPlatformMember(input: { userId: string; role: PlatformRole; createdBy?: string | null; now?: string }): PlatformMember {
  const now = input.now ?? new Date().toISOString()
  return { userId: input.userId, role: input.role, status: "active", createdBy: input.createdBy ?? null, createdAt: now, updatedAt: now }
}
