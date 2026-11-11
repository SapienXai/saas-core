import { NextResponse } from "next/server"
import { getAccountState, safeInternalRedirect } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { cookies } from "next/headers"
import { usesNeonBackend } from "@/lib/backend"
import { INVITATION_INTENT_COOKIE } from "@/lib/invitations"
import { getRequestUrl } from "@/lib/request-url"
import { getProductOnboardingPath, isDeferredWorkspaceProvisioning } from "@/lib/product-config"

function navigationResponse(destination: string, url: URL, asJson: boolean) {
  if (asJson) {
    return NextResponse.json({ redirectTo: destination }, {
      headers: { "Cache-Control": "no-store" },
    })
  }
  return NextResponse.redirect(new URL(destination, url))
}

export async function GET(request: Request) {
  const url = getRequestUrl(request)
  const asJson = request.headers.get("accept")?.includes("application/json") ?? false
  const state = await getAccountState()
  if (!state.authenticated) {
    const verificationError = url.searchParams.get("error")
    if (usesNeonBackend() && (verificationError === "TOKEN_EXPIRED" || verificationError === "INVALID_TOKEN")) {
      const fallback = isDeferredWorkspaceProvisioning() ? getProductOnboardingPath() : "/onboarding"
      const redirect = safeInternalRedirect(url.searchParams.get("redirect"), fallback)
      const query = new URLSearchParams({ confirmation: "expired", redirect })
      return navigationResponse(`/signup?${query}`, url, asJson)
    }
    return navigationResponse(`/login?redirect=${encodeURIComponent("/app")}`, url, asJson)
  }

  const requested = safeInternalRedirect(url.searchParams.get("redirect"), state.path)
  const invitationRequested = Boolean((await cookies()).get(INVITATION_INTENT_COOKIE)?.value) || requested === "/invite/accept"
  if (invitationRequested) {
    return navigationResponse("/invite/accept", url, asJson)
  }

  const access = requested.startsWith("/platform") || !state.workspaceId ? await getCurrentUserAccess() : null
  const platformRequested = requested.startsWith("/platform") && Boolean(access?.platformRole)
  const platformHome = !state.workspaceId && Boolean(access?.platformRole) ? "/platform" : null
  const deferredProductSetup = !state.workspaceId && isDeferredWorkspaceProvisioning() ? getProductOnboardingPath() : null
  const destination = platformRequested
    ? requested
    : platformHome || deferredProductSetup || (state.path === "/onboarding" ? "/onboarding" : requested.startsWith("/app") ? requested : "/app")
  return navigationResponse(destination, url, asJson)
}
