import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { hashInvitationToken, INVITATION_INTENT_COOKIE, isInvitationToken } from "@/lib/invitations"
import { getRequestUrl } from "@/lib/request-url"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export async function GET(request: Request) {
  const url = getRequestUrl(request)
  if (PRODUCT_CONFIG.capabilities.workspaceTeamManagement === false) {
    return NextResponse.redirect(new URL(PRODUCT_CONFIG.shell?.homePath || "/manage", url))
  }
  const token = url.searchParams.get("token")
  if (!isInvitationToken(token)) return NextResponse.redirect(new URL("/login?error=invalid_invitation", url))

  const tokenHash = hashInvitationToken(token)
  const { data: invitation } = await createServiceRoleClient()
    .from("workspace_invitations")
    .select("id, expires_at, accepted_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle()
  if (!invitation || invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() <= Date.now()) {
    return NextResponse.redirect(new URL("/login?error=invalid_invitation", url))
  }

  let authenticated = false
  try {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase.auth.getUser()
    authenticated = Boolean(data.user)
  } catch {
    authenticated = false
  }

  const response = NextResponse.redirect(new URL(authenticated ? "/invite/accept" : "/signup?redirect=/invite/accept", url))
  response.cookies.set(INVITATION_INTENT_COOKIE, tokenHash, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 15 * 60,
    path: "/",
  })
  return response
}
