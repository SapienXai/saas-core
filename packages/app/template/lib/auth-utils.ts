import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { cache } from "react"
import { isPlatformRole, type PlatformRole } from "@/lib/platform-types"

export type WorkspaceRole = "owner" | "admin" | "manager" | "staff" | "readonly"

export interface UserAccess {
  userId: string
  email: string
  name: string
  role: WorkspaceRole | string
  workspaceRole: WorkspaceRole | string | null
  workspaceAvailable: boolean
  platformRole: PlatformRole | null
  isSuperAdmin: boolean
}

export type WorkspaceMembership = {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole | string
  created_at?: string
  workspaces?: { id: string; name: string; slug: string; status: string } | { id: string; name: string; slug: string; status: string }[] | null
}

export function isReadonlyRole(role?: string | null) { return role === "readonly" }
export function canWrite(access: UserAccess | null) {
  if (!access) return false
  const role = access.workspaceAvailable ? access.workspaceRole : access.role
  return Boolean(role && !isReadonlyRole(role))
}
export function canManageWorkspaceUsers(access: UserAccess | null) {
  if (!access) return false
  const role = access.workspaceAvailable ? access.workspaceRole : access.role
  return role === "owner" || role === "admin"
}

function schemaUnavailable(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = error?.message?.toLowerCase() || ""
  return error?.code === "42P01" || error?.code === "42703" || message.includes("workspace_members") || message.includes("workspaces")
}
function platformSchemaUnavailable(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = error?.message?.toLowerCase() || ""
  return error?.code === "42P01" || error?.code === "42703" || message.includes("platform_members") || message.includes("platform_user_controls")
}

async function getPlatformMember(userId: string) {
  const { data, error } = await (createServiceRoleClient() as any).from("platform_members").select("user_id, role, status").eq("user_id", userId).maybeSingle()
  if (error) {
    if (!platformSchemaUnavailable(error)) console.error("Error resolving platform membership:", error)
    return { available: !platformSchemaUnavailable(error), member: null as { role: PlatformRole; status: "active" | "suspended" } | null }
  }
  return { available: true, member: data && isPlatformRole(data.role) ? { role: data.role, status: data.status === "suspended" ? "suspended" : "active" } : null }
}

async function getPlatformUserControl(userId: string) {
  const { data, error } = await (createServiceRoleClient() as any).from("platform_user_controls").select("status").eq("user_id", userId).maybeSingle()
  if (error) {
    if (!platformSchemaUnavailable(error)) console.error("Error resolving platform user control:", error)
    return null
  }
  return data?.status === "suspended" ? "suspended" : "active"
}

async function bootstrapPlatformOwner(userId: string, email: string | null | undefined, memberExists: boolean) {
  const configuredEmail = process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase()
  if (memberExists || !configuredEmail || !email || email.trim().toLowerCase() !== configuredEmail) return false
  const { error } = await (createServiceRoleClient() as any).from("platform_members").upsert({ user_id: userId, role: "platform_owner", status: "active", created_by: userId }, { onConflict: "user_id", ignoreDuplicates: true })
  if (error) {
    if (!platformSchemaUnavailable(error)) console.error("Error bootstrapping platform owner:", error)
    return false
  }
  return true
}

export const getWorkspaceMemberships = cache(async function getWorkspaceMemberships(userId: string) {
  const { data, error } = await (createServiceRoleClient() as any)
    .from("workspace_members")
    .select("id, workspace_id, user_id, role, created_at, workspaces!inner(id, name, slug, status)")
    .eq("user_id", userId)
    .eq("workspaces.status", "active")
    .order("created_at", { ascending: true })
  if (error) {
    if (schemaUnavailable(error)) return { available: false, memberships: [] as WorkspaceMembership[] }
    console.error("Error resolving workspace memberships:", error)
    return { available: true, memberships: [] as WorkspaceMembership[] }
  }
  return { available: true, memberships: (data || []) as WorkspaceMembership[] }
})

export const getPreferredWorkspaceId = cache(async function getPreferredWorkspaceId() {
  try { return (await cookies()).get("saas_core_workspace_id")?.value || null } catch { return null }
})

export const getAuthenticatedUser = cache(async function getAuthenticatedUser() {
  const { data, error } = await (await createSupabaseServerClient()).auth.getUser()
  return error ? null : data.user
})

export const getCurrentUserAccess = cache(async function getCurrentUserAccess(): Promise<UserAccess | null> {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return null
    const [control, initialPlatform, memberships] = await Promise.all([getPlatformUserControl(user.id), getPlatformMember(user.id), getWorkspaceMemberships(user.id)])
    if (control === "suspended") return null
    let platform = initialPlatform
    if (platform.available && !platform.member && user.email && await bootstrapPlatformOwner(user.id, user.email, false)) platform = await getPlatformMember(user.id)
    const preferred = await getPreferredWorkspaceId()
    const membership = memberships.memberships.find((item) => item.workspace_id === preferred) || memberships.memberships[0]
    const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : ""
    return {
      userId: user.id,
      email: user.email?.trim() || "",
      name,
      // Platform authority is deliberately not represented as a Workspace
      // role. Platform-only operators have no implied Workspace admin access.
      role: membership?.role || "staff",
      workspaceRole: membership?.role || null,
      workspaceAvailable: memberships.available,
      platformRole: platform.member?.status === "active" ? platform.member.role : null,
      isSuperAdmin: platform.member?.status === "active" && platform.member.role === "platform_owner",
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("Supabase server authentication is not configured")) console.error("Error resolving user access:", error)
    return null
  }
})
