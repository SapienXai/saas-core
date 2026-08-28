import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { classifyHostname, getRequestHostname, getTrustedPlatformOrigin } from "@/lib/domains/hostname"
import { getRequestUrl } from "@/lib/request-url"
import { isCanonicalAppPath, normalizeRequestPathname } from "@/lib/route-ownership"

export async function proxy(request: NextRequest) {
  const pathname = normalizeRequestPathname(request.nextUrl.pathname) || "/"
  const requestUrl = getRequestUrl(request)
  const classification = classifyHostname(getRequestHostname(request) || "")
  const isTenantHost = classification.kind === "HOSTED_WORKSPACE" || classification.kind === "CUSTOM_WORKSPACE"

  if (classification.kind === "PLATFORM_WWW") {
    const redirectUrl = new URL(pathname + request.nextUrl.search, getTrustedPlatformOrigin("root"))
    return NextResponse.redirect(redirectUrl, 308)
  }

  // Management and authentication have one canonical origin. Local *.localhost testing keeps the direct route.
  if (isTenantHost && isCanonicalAppPath(pathname)) {
    const redirectUrl = new URL(pathname + request.nextUrl.search, getTrustedPlatformOrigin("app"))
    return NextResponse.redirect(redirectUrl, 307)
  }

  const isManageRoute =
    ((pathname === "/app" || pathname.startsWith("/app/")) || (pathname === "/manage" || pathname.startsWith("/manage/"))) &&
    !pathname.startsWith("/manage/login") &&
    !pathname.startsWith("/manage/reset-password") &&
    !pathname.startsWith("/manage/update-password")
  const isOnboardingRoute = pathname === "/onboarding"
  const isPlatformRoute = pathname === "/platform" || pathname.startsWith("/platform/")
  // Login must stay reachable even when the browser has a stale or expired
  // Supabase cookie. The form can replace that session; forcing a getUser()
  // round-trip here can leave the entry screen stuck behind auth redirects.
  const isAuthEntryRoute = ["/signup", "/manage/login"].includes(pathname)
  const isPlatformAppRoot = classification.kind === "PLATFORM_APP" && pathname === "/"
  const needsSession = isManageRoute || isPlatformRoute || isOnboardingRoute || isAuthEntryRoute || isPlatformAppRoot

  // Public entry and auth pages do not need a session lookup. Avoiding the
  // Supabase roundtrip here keeps the unauthenticated surface responsive.
  if (!needsSession) return NextResponse.next()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return NextResponse.next()

  const hasAuthCookie = request.cookies.getAll().some(({ name }) => (
    (name.startsWith("sb-") && name.includes("-auth-token")) || name === "sb-access-token"
  ))

  // Most anonymous visits can be decided from the absence of an auth cookie, without creating a Supabase client or making a network request.
  if (!hasAuthCookie) {
    if (isManageRoute || isPlatformRoute || isOnboardingRoute) {
      const redirectUrl = new URL("/login", requestUrl)
      if (isManageRoute || isPlatformRoute) redirectUrl.searchParams.set("redirect", pathname)
      return NextResponse.redirect(redirectUrl)
    }
    if (isPlatformAppRoot) {
      return NextResponse.redirect(new URL("/login?redirect=%2Fapp", requestUrl))
    }
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    auth: { flowType: "pkce", autoRefreshToken: false, persistSession: false },
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  let hasSession = false
  try {
    const { data } = await supabase.auth.getUser()
    hasSession = Boolean(data.user)
  } catch {
    hasSession = false
  }

  if (isManageRoute && !hasSession) {
    const redirectUrl = new URL("/login", requestUrl)
    redirectUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(redirectUrl)
  }

  if (isPlatformRoute && !hasSession) {
    const redirectUrl = new URL("/login", requestUrl)
    redirectUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(redirectUrl)
  }

  if (isOnboardingRoute && !hasSession) {
    const redirectUrl = new URL("/login", requestUrl)
    redirectUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(redirectUrl)
  }

  const isLogoutRequest = request.nextUrl.searchParams.get("logged_out") === "1"
  if (hasSession && !isLogoutRequest && ["/signup", "/manage/login"].includes(pathname)) {
    return NextResponse.redirect(new URL("/auth/continue", requestUrl))
  }

  if (isPlatformAppRoot && hasSession) {
    return NextResponse.redirect(new URL("/auth/continue", requestUrl))
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)"],
}
