import "server-only"
import { getAuthenticatedUser, getPreferredWorkspaceId, getWorkspaceMemberships } from "@/lib/auth-utils"
import { createServiceRoleClient } from "@/lib/supabase"
import { cache } from "react"

export type AccountState =
  | { authenticated: false; path: "/login" }
  | { authenticated: true; path: "/onboarding" | "/app"; userId: string; workspaceId: string | null; workspaceSlug: string | null; onboardingComplete: boolean }

export const getAccountState = cache(async function getAccountState(): Promise<AccountState> {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return { authenticated: false, path: "/login" }
    const memberships = await getWorkspaceMemberships(user.id); const preferred = await getPreferredWorkspaceId(); const membership = memberships.memberships.find((item) => item.workspace_id === preferred) || memberships.memberships[0]
    const service = createServiceRoleClient() as any
    if (membership) {
      const { data: workspace } = await service.from("workspaces").select("id, slug, created_by, onboarding_completed_at, status").eq("id", membership.workspace_id).maybeSingle()
      // The only Core onboarding step creates an active workspace and its owner
      // membership. An existing owner workspace is therefore already a valid
      // Core foundation even if an older row predates onboarding_completed_at.
      // Invited members are never sent through owner onboarding.
      const complete = membership.role !== "owner" || Boolean(workspace?.id)
      return { authenticated: true, path: complete ? "/app" : "/onboarding", userId: user.id, workspaceId: workspace?.id || membership.workspace_id, workspaceSlug: workspace?.slug || null, onboardingComplete: complete }
    }
    const { data: own } = await service.from("workspaces").select("id, slug, onboarding_completed_at").eq("created_by", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle()
    if (own) return { authenticated: true, path: "/app", userId: user.id, workspaceId: own.id, workspaceSlug: own.slug, onboardingComplete: true }
    return { authenticated: true, path: "/onboarding", userId: user.id, workspaceId: null, workspaceSlug: null, onboardingComplete: false }
  } catch {
    // Public entry/auth pages must remain renderable before a product has
    // configured Supabase. Protected pages still call their own auth guards.
    return { authenticated: false, path: "/login" }
  }
})
export function safeInternalRedirect(value: string | null | undefined, fallback: string) { if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback; if (["/login", "/signup", "/forgot-password", "/reset-password"].includes(value)) return fallback; return value }
