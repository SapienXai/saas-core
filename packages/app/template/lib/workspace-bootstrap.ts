import "server-only"

import { getPreferredWorkspaceId } from "@/lib/auth-utils"
import { requireUser } from "@/lib/authorization"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

export type InitialWorkspace = {
  workspaceId: string
  workspaceSlug: string
}

export type InitialWorkspaceErrorCode =
  | "AUTH_REQUIRED"
  | "AUTHORIZATION_UNAVAILABLE"
  | "INVALID_WORKSPACE_NAME"
  | "WORKSPACE_LIMIT_REACHED"
  | "WORKSPACE_LIMIT_NOT_CONFIGURED"
  | "PLAN_NOT_CONFIGURED"
  | "SLUG_RESERVED"
  | "WORKSPACE_BOOTSTRAP_FAILED"

export class InitialWorkspaceError extends Error {
  constructor(public readonly code: InitialWorkspaceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "InitialWorkspaceError"
  }
}

function databaseErrorCode(error: unknown): InitialWorkspaceErrorCode {
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : ""
  if (message.includes("AUTH_REQUIRED")) return "AUTH_REQUIRED"
  if (message.includes("INVALID_WORKSPACE_NAME")) return "INVALID_WORKSPACE_NAME"
  if (message.includes("WORKSPACE_LIMIT_REACHED")) return "WORKSPACE_LIMIT_REACHED"
  if (message.includes("WORKSPACE_LIMIT_NOT_CONFIGURED")) return "WORKSPACE_LIMIT_NOT_CONFIGURED"
  if (message.includes("PLAN_NOT_CONFIGURED")) return "PLAN_NOT_CONFIGURED"
  if (message.includes("SLUG_RESERVED")) return "SLUG_RESERVED"
  return "WORKSPACE_BOOTSTRAP_FAILED"
}

function databaseErrorMessage(code: InitialWorkspaceErrorCode) {
  switch (code) {
    case "AUTH_REQUIRED": return "Please sign in again and retry."
    case "INVALID_WORKSPACE_NAME": return "We could not use that name. Try a different name."
    case "WORKSPACE_LIMIT_REACHED": return "Your current plan has reached its workspace limit."
    case "WORKSPACE_LIMIT_NOT_CONFIGURED": return "Workspace limits are not configured for this product yet."
    case "PLAN_NOT_CONFIGURED": return "Workspace plans are not configured yet."
    case "SLUG_RESERVED": return "We could not create a safe address from that name. Try a different name."
    case "AUTHORIZATION_UNAVAILABLE": return "Workspace authorization is temporarily unavailable. Try again."
    default: return "We could not prepare your workspace. Try again."
  }
}

function cleanNameHint(value: string | null | undefined) {
  const name = value?.trim() || "Workspace"
  return name.slice(0, 120)
}

/**
 * Ensure the authenticated user has one usable initial Workspace.
 *
 * This is deliberately product-neutral: the caller supplies only a display
 * name hint. Membership, limits, slug generation and owner creation remain in
 * the Core database function. Existing memberships are always reused.
 */
export async function ensureInitialWorkspace(input: { nameHint?: string | null } = {}): Promise<InitialWorkspace> {
  await requireUser()

  try {
    const preferredWorkspaceId = await getPreferredWorkspaceId()
    const { data, error } = await (await createSupabaseServerClient()).rpc("ensure_initial_workspace", {
      target_workspace_name: cleanNameHint(input.nameHint),
      target_workspace_id: preferredWorkspaceId,
    })
    if (error || !data?.[0]?.workspace_id || !data[0]?.workspace_slug) {
      const code = databaseErrorCode(error)
      throw new InitialWorkspaceError(code, databaseErrorMessage(code), { cause: error })
    }

    const workspace = { workspaceId: data[0].workspace_id as string, workspaceSlug: data[0].workspace_slug as string }
    const cookieStore = await cookies()
    cookieStore.set("saas_core_workspace_id", workspace.workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 90,
      path: "/",
    })
    revalidatePath("/app")
    return workspace
  } catch (error) {
    if (error instanceof InitialWorkspaceError) throw error
    throw new InitialWorkspaceError("WORKSPACE_BOOTSTRAP_FAILED", databaseErrorMessage("WORKSPACE_BOOTSTRAP_FAILED"), { cause: error })
  }
}
