"use server"
import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/authorization"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"

function slugify(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace" }
export async function createWorkspace(input: { name?: string; slug?: string }) {
  try {
    await requireUser(); const name = input.name?.trim() || ""; if (name.length < 2) return { success: false, message: "Workspace name must be at least two characters." }
    const slug = slugify(input.slug || name); const service = createServiceRoleClient() as any
    const { data: existing } = await service.from("workspaces").select("id").eq("slug", slug).maybeSingle(); if (existing) return { success: false, message: "That workspace address is already in use." }
    const { data, error } = await (await createSupabaseServerClient()).rpc("bootstrap_initial_workspace", { target_workspace_name: name, target_workspace_slug: slug })
    if (error || !data?.[0]) {
      if (error?.message?.includes("WORKSPACE_LIMIT_REACHED")) return { success: false, message: "Your current plan does not allow another workspace." }
      if (error?.message?.includes("PLAN_NOT_CONFIGURED")) return { success: false, message: "Workspace plans are not configured yet." }
      return { success: false, message: error?.message || "Workspace could not be created." }
    }
    revalidatePath("/app"); return { success: true, data }
  } catch { return { success: false, message: "Please sign in again and retry." } }
}
