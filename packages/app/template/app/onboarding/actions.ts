"use server"
import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/authorization"
import { createServiceRoleClient } from "@/lib/supabase"
import { getWorkspaceEntitlements } from "@/lib/entitlements"

function slugify(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace" }
export async function createWorkspace(input: { name?: string; slug?: string }) {
  try {
    const access = await requireUser(); const name = input.name?.trim() || ""; if (name.length < 2) return { success: false, message: "Workspace name must be at least two characters." }
    const slug = slugify(input.slug || name); const service = createServiceRoleClient() as any
    const { data: existing } = await service.from("workspaces").select("id").eq("slug", slug).maybeSingle(); if (existing) return { success: false, message: "That workspace address is already in use." }
    const { data: workspace, error } = await service.from("workspaces").insert({ name, slug, created_by: access.userId, status: "active" }).select("id, name, slug").single()
    if (error || !workspace) return { success: false, message: error?.message || "Workspace could not be created." }
    const membership = await service.from("workspace_members").insert({ workspace_id: workspace.id, user_id: access.userId, role: "owner" })
    if (membership.error) { await service.from("workspaces").delete().eq("id", workspace.id); return { success: false, message: "Workspace membership could not be created." } }
    await getWorkspaceEntitlements(workspace.id).catch(() => null); revalidatePath("/app"); return { success: true, data: workspace }
  } catch { return { success: false, message: "Please sign in again and retry." } }
}
