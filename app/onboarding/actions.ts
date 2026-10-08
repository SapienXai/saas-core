"use server"
import { revalidatePath } from "next/cache"
import { requireProductCapability, requireUser, requireWorkspaceCreationAccess } from "@/lib/authorization"
import { getPreferredWorkspaceId, getWorkspaceMemberships } from "@/lib/auth-utils"
import { getWorkspaceEntitlements } from "@/lib/entitlements"
import { getProductOnboardingPath } from "@/lib/product-config"
import { ensurePlatformSubdomain } from "@/lib/domains/domain-service"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

function slugify(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace" }
export async function createWorkspace(input: { name?: string; slug?: string }, mode: "initial" | "additional" = "initial") {
  try {
    const access = await requireUser()
    const memberships = await getWorkspaceMemberships(access.userId)
    const service = createServiceRoleClient() as any
    const { data: existingOwned } = await service.from("workspaces").select("id, slug").eq("created_by", access.userId).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle()

    // The initial Core flow is idempotent. A member or owner who revisits the
    // URL must continue to the app, while additional workspaces remain an
    // explicit in-app action.
    if (mode === "initial" && (memberships.memberships[0] || existingOwned)) {
      const current = (memberships.memberships[0] || existingOwned) as any
      const workspaceId = current.workspace_id || current.id
      const workspaceSlug = current.workspace_slug || (Array.isArray(current.workspaces) ? current.workspaces[0]?.slug : current.workspaces?.slug) || current.slug
      await ensurePlatformSubdomain(workspaceId, workspaceSlug)
      return { success: true as const, data: [{ workspace_id: workspaceId, workspace_slug: workspaceSlug }], nextPath: getProductOnboardingPath() }
    }
    if (mode === "additional") {
      await requireProductCapability("workspaceManagement")
      await requireWorkspaceCreationAccess()
    }

    const name = input.name?.trim() || ""
    if (name.length < 2) return { success: false as const, message: "Workspace name must be at least two characters." }
    const slug = slugify(input.slug || name)
    const { data: existing } = await service.from("workspaces").select("id").eq("slug", slug).maybeSingle(); if (existing) return { success: false, message: "That workspace address is already in use." }
    const { data, error } = await (await createSupabaseServerClient()).rpc("bootstrap_initial_workspace", { target_workspace_name: name, target_workspace_slug: slug })
    if (error || !data?.[0]) {
      if (error?.message?.includes("WORKSPACE_LIMIT_REACHED")) {
        const preferred = await getPreferredWorkspaceId()
        const current = memberships.memberships.find((item) => item.workspace_id === preferred) || memberships.memberships[0]
        const entitlements = current ? await getWorkspaceEntitlements(current.workspace_id).catch(() => null) : null
        const limit = entitlements?.limits["core.workspaces"]
        return { success: false as const, message: typeof limit === "number" ? `Your current plan allows ${limit} workspace${limit === 1 ? "" : "s"}. You have reached that limit.` : "Your current plan has reached its workspace limit." }
      }
      if (error?.message?.includes("WORKSPACE_LIMIT_NOT_CONFIGURED")) return { success: false as const, message: "Your product catalog must explicitly configure the workspace limit before another workspace can be created." }
      if (error?.message?.includes("PLAN_NOT_CONFIGURED")) return { success: false, message: "Workspace plans are not configured yet." }
      return { success: false, message: error?.message || "Workspace could not be created." }
    }
    const workspace = data[0] as { workspace_id: string; workspace_slug: string }
    await ensurePlatformSubdomain(workspace.workspace_id, workspace.workspace_slug)
    const cookieStore = await cookies()
    cookieStore.set("saas_core_workspace_id", workspace.workspace_id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" })
    revalidatePath("/app")
    return { success: true as const, data, nextPath: mode === "initial" ? getProductOnboardingPath() : "/app" }
  } catch { return { success: false, message: "Please sign in again and retry." } }
}
