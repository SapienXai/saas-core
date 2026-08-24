import type { SupabaseClient } from "@supabase/supabase-js"
import { CoreError } from "@sapienx/saas-core"
import { requireUser, type CoreCookieStore } from "./supabase.js"

export const CURRENT_WORKSPACE_COOKIE = "saas_core_workspace"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export type CurrentWorkspace = {
  id: string
  name: string
  slug: string
  status: "active" | "suspended" | "archived"
  created_by: string
  preferred_timezone: string
  onboarding_completed_at: string | null
  created_at: string
  updated_at: string
  workspace_members: Array<{ user_id: string; role: string; status: string }>
}

export type WorkspaceContext = {
  workspaces: CurrentWorkspace[]
  currentWorkspace: CurrentWorkspace | null
}

async function listMemberships(client: SupabaseClient): Promise<CurrentWorkspace[]> {
  const user = await requireUser(client)
  const result = await client
    .from("workspaces")
    .select("id, name, slug, status, created_by, preferred_timezone, onboarding_completed_at, created_at, updated_at, workspace_members!inner(user_id, role, status)")
    .eq("workspace_members.user_id", user.id)
    .eq("workspace_members.status", "active")
    .order("created_at", { ascending: true })
  if (result.error) throw new CoreError("CONFIGURATION_ERROR", `Could not resolve workspaces: ${result.error.message}`)
  return (result.data ?? []) as unknown as CurrentWorkspace[]
}

export async function resolveCurrentWorkspace(client: SupabaseClient, cookieStore: CoreCookieStore): Promise<WorkspaceContext> {
  const workspaces = await listMemberships(client)
  const requestedId = cookieStore.getAll().find((cookie) => cookie.name === CURRENT_WORKSPACE_COOKIE)?.value
  const currentWorkspace = workspaces.find((workspace) => workspace.id === requestedId && workspace.status === "active")
    ?? workspaces.find((workspace) => workspace.status === "active")
    ?? null
  return { workspaces, currentWorkspace }
}

export async function requireCurrentWorkspace(client: SupabaseClient, cookieStore: CoreCookieStore): Promise<CurrentWorkspace> {
  const context = await resolveCurrentWorkspace(client, cookieStore)
  if (!context.currentWorkspace) throw new CoreError("NOT_FOUND", "Create or join an active workspace before continuing.")
  return context.currentWorkspace
}

export async function setCurrentWorkspace(client: SupabaseClient, cookieStore: CoreCookieStore, workspaceId: string): Promise<CurrentWorkspace> {
  const context = await resolveCurrentWorkspace(client, cookieStore)
  const workspace = context.workspaces.find((candidate) => candidate.id === workspaceId)
  if (!workspace || workspace.status !== "active") throw new CoreError("FORBIDDEN", "You are not an active member of that workspace.")
  cookieStore.set?.(CURRENT_WORKSPACE_COOKIE, workspace.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  })
  return workspace
}
