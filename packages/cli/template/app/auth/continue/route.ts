import { NextResponse } from "next/server"
import { getAccountState, safeInternalRedirect } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { cookies } from "next/headers"
import { INVITATION_INTENT_COOKIE } from "@/lib/invitations"
import { getRequestUrl } from "@/lib/request-url"

export async function GET(request: Request) {
  const url = getRequestUrl(request)
  const state = await getAccountState()
  if (!state.authenticated) {
    return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent("/app")}`, url))
  }

  const requested = safeInternalRedirect(url.searchParams.get("redirect"), state.path)
  const invitationRequested = Boolean((await cookies()).get(INVITATION_INTENT_COOKIE)?.value) || requested === "/invite/accept"
  if (invitationRequested) {
    return NextResponse.redirect(new URL("/invite/accept", url))
  }

  const access = requested.startsWith("/platform") ? await getCurrentUserAccess() : null
  const platformRequested = requested.startsWith("/platform") && Boolean(access?.platformRole)
  const destination = platformRequested
    ? requested
    : state.path === "/onboarding" ? "/onboarding" : requested.startsWith("/app") ? requested : "/app"
  return NextResponse.redirect(new URL(destination, url))
}
