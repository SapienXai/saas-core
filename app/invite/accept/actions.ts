"use server"

import { cookies } from "next/headers"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { INVITATION_INTENT_COOKIE } from "@/lib/invitations"

export async function acceptInvitation() {
  const cookieStore = await cookies()
  const tokenHash = cookieStore.get(INVITATION_INTENT_COOKIE)?.value
  if (!tokenHash) return { success: false, message: "This invitation link is missing or has expired." }

  const supabase = await createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { success: false, message: "Sign in or create an account before accepting this invitation." }

  const { data, error } = await supabase.rpc("accept_workspace_invitation", { target_token_hash: tokenHash })
  if (error || !data?.[0]) {
    const message = error?.message || "Invitation could not be accepted."
    if (message.includes("EMAIL_MISMATCH")) return { success: false, message: "Sign in with the email address that received this invitation." }
    if (message.includes("USER_LIMIT_REACHED")) return { success: false, message: "This workspace currently has no available team seats." }
    if (message.includes("EXPIRED")) return { success: false, message: "This invitation has expired or was revoked." }
    if (message.includes("ALREADY_MEMBER")) return { success: false, message: "You are already a member of this workspace." }
    if (message.includes("ALREADY_ACCEPTED")) return { success: false, message: "This invitation has already been used." }
    return { success: false, message: "This invitation could not be accepted." }
  }

  cookieStore.delete(INVITATION_INTENT_COOKIE)
  cookieStore.set("reservevia_workspace_id", data[0].workspace_id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" })
  return { success: true, workspaceId: data[0].workspace_id }
}
