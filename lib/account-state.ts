import "server-only"
import { getPreferredWorkspaceId, getWorkspaceMemberships } from "@/lib/auth-utils"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export type AccountState =
  | { authenticated: false; path: "/login" }
  | { authenticated: true; path: "/onboarding" | "/app"; userId: string; workspaceId: string | null; workspaceSlug: string | null; onboardingComplete: boolean }

export async function getAccountState(): Promise<AccountState> {
  const { data, error } = await (await createSupabaseServerClient()).auth.getUser()
  if (error || !data.user) return { authenticated: false, path: "/login" }
  const memberships = await getWorkspaceMemberships(data.user.id); const preferred = await getPreferredWorkspaceId(); const membership = memberships.memberships.find((item) => item.workspace_id === preferred) || memberships.memberships[0]
  const service = createServiceRoleClient() as any
  if (membership) {
    const { data: workspace } = await service.from("workspaces").select("id, slug, created_by, onboarding_completed_at, status").eq("id", membership.workspace_id).maybeSingle()
    const complete = Boolean(workspace?.onboarding_completed_at)
    return { authenticated: true, path: workspace?.created_by === data.user.id && !complete ? "/onboarding" : "/app", userId: data.user.id, workspaceId: workspace?.id || membership.workspace_id, workspaceSlug: workspace?.slug || null, onboardingComplete: complete }
  }
  const { data: own } = await service.from("workspaces").select("id, slug, onboarding_completed_at").eq("created_by", data.user.id).order("created_at", { ascending: true }).limit(1).maybeSingle()
  if (own) return { authenticated: true, path: own.onboarding_completed_at ? "/app" : "/onboarding", userId: data.user.id, workspaceId: own.id, workspaceSlug: own.slug, onboardingComplete: Boolean(own.onboarding_completed_at) }
  return { authenticated: true, path: "/onboarding", userId: data.user.id, workspaceId: null, workspaceSlug: null, onboardingComplete: false }
}
export function safeInternalRedirect(value: string | null | undefined, fallback: string) { if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback; if (["/login", "/signup", "/forgot-password", "/reset-password"].includes(value)) return fallback; return value }
