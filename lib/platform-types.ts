export const PLATFORM_ROLES = [
  "platform_owner",
  "platform_admin",
  "billing_admin",
  "support",
  "auditor",
] as const

export type PlatformRole = (typeof PLATFORM_ROLES)[number]

export type PlatformMember = {
  user_id: string
  role: PlatformRole
  status: "active" | "suspended"
  created_by: string | null
  created_at: string
  updated_at: string
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && PLATFORM_ROLES.includes(value as PlatformRole)
}

export function formatPlatformRole(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "Unknown role"
  return value.trim().replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

export function platformRoleAllows(role: PlatformRole | null | undefined, allowedRoles: readonly PlatformRole[]) {
  return Boolean(role && allowedRoles.includes(role))
}
