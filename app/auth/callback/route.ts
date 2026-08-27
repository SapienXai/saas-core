import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getAccountState, safeInternalRedirect } from "@/lib/account-state"
import { getRequestUrl } from "@/lib/request-url"

// Shared PKCE callback for social OAuth and older confirmation links. New
// email links use /auth/confirm so email flows keep their dedicated handling.
export async function GET(request: Request) {
  const url = getRequestUrl(request)
  const code = url.searchParams.get("code")
  if (!code) {
    const providerError = url.searchParams.get("error")
    const providerDescription = url.searchParams.get("error_description")
    console.error("[auth/callback] OAuth provider returned no code", {
      error: providerError || "missing_code",
      description: providerDescription || undefined,
    })
    return NextResponse.redirect(new URL("/login?error=oauth_failed", url))
  }
  const next = safeInternalRedirect(url.searchParams.get("next"), "/app")
  const flowId = url.searchParams.get("sb_flow_id")
  const exchangeOptions = flowId ? { flowId } : undefined

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code, exchangeOptions)
  if (error) {
    console.error("[auth/callback] OAuth code exchange failed", {
      name: error.name,
      message: error.message,
      code: error.code,
      status: error.status,
    })
    return NextResponse.redirect(new URL("/login?error=oauth_exchange_failed", url))
  }

  const state = await getAccountState()
  if (!state.authenticated) {
    console.error("[auth/callback] OAuth session exchange succeeded but no server session was found")
    return NextResponse.redirect(new URL("/login?error=oauth_session_missing", url))
  }

  const continueUrl = new URL("/auth/continue", url)
  continueUrl.searchParams.set("redirect", next)
  return NextResponse.redirect(continueUrl)
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "Use the Supabase SSR confirmation route." }, { status: 410 })
}
