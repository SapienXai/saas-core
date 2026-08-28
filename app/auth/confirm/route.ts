import { NextResponse } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getAccountState, safeInternalRedirect } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { INVITATION_INTENT_COOKIE } from "@/lib/invitations"
import { getRequestUrl } from "@/lib/request-url"

export async function GET(request: Request) {
  const url = getRequestUrl(request)
  const tokenHash = url.searchParams.get("token_hash")
  const rawType = url.searchParams.get("type")
  const tokenType = rawType === "email" || rawType === "recovery" ? rawType as EmailOtpType : null
  const code = url.searchParams.get("code")
  const next = safeInternalRedirect(url.searchParams.get("next"), "/onboarding")

  if (!tokenHash && !code) {
    return NextResponse.redirect(new URL("/login?error=invalid_confirmation", url))
  }

  const supabase = await createSupabaseServerClient()
  const { error } = tokenHash && tokenType
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tokenType })
    : await supabase.auth.exchangeCodeForSession(code!)
  if (error) {
    return NextResponse.redirect(new URL("/login?error=invalid_confirmation", url))
  }

  if (tokenType === "recovery" || rawType === "recovery") {
    return NextResponse.redirect(new URL("/reset-password", url))
  }

  const state = await getAccountState()
  const invitationRequested = Boolean((await cookies()).get(INVITATION_INTENT_COOKIE)?.value) || next === "/invite/accept"
  const access = state.authenticated && !state.workspaceId ? await getCurrentUserAccess() : null
  const destination = state.authenticated
    ? invitationRequested ? "/invite/accept" : access?.platformRole && !state.workspaceId ? "/platform" : state.path === "/onboarding" ? "/onboarding" : "/app"
    : "/login"
  return NextResponse.redirect(new URL(destination, url))
}
