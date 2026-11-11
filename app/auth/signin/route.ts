import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { usesNeonBackend } from "@/lib/backend"
import { copyAuthCookies, neonAuthPost } from "@/lib/neon/auth"
import { safeInternalRedirect } from "@/lib/account-state"
import { getRequestUrl } from "@/lib/request-url"

type SignInBody = {
  email?: unknown
  password?: unknown
  redirect?: unknown
}

export async function POST(request: Request) {
  let body: SignInBody
  const isFormRequest = request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")
  try {
    body = isFormRequest
      ? Object.fromEntries((await request.formData()).entries())
      : await request.json() as SignInBody
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const email = typeof body.email === "string" ? body.email.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  const redirect = safeInternalRedirect(typeof body.redirect === "string" ? body.redirect : null, "/app")
  const requestUrl = getRequestUrl(request)
  if (!email || !password) {
    if (isFormRequest) return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(redirect)}&error=invalid_request`, requestUrl), 303)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (usesNeonBackend()) {
    const result = await neonAuthPost(request, "sign-in/email", { email, password })
    if (!result.ok) {
      const payload = await result.json().catch(() => null)
      const code = payload?.code === "EMAIL_NOT_VERIFIED" ? "email_not_confirmed" : "invalid_credentials"
      if (isFormRequest) return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(redirect)}&error=${code}`, requestUrl), 303)
      return NextResponse.json({ error: code }, { status: result.status === 429 ? 429 : 401 })
    }
    return copyAuthCookies(result, isFormRequest
      ? NextResponse.redirect(new URL(`/auth/continue?redirect=${encodeURIComponent(redirect)}`, requestUrl), 303)
      : NextResponse.json({ ok: true }))
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    if (isFormRequest) return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(redirect)}&error=service_unavailable`, requestUrl), 303)
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 })
  }

  const cookieStore = await cookies()
  let requestCookies = cookieStore.getAll()
  const continuation = `/auth/continue?redirect=${encodeURIComponent(redirect)}`
  const response = isFormRequest
    ? new NextResponse(`<!doctype html><meta http-equiv="refresh" content="0;url=${continuation}"><script>window.location.replace(${JSON.stringify(continuation)})</script>`, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
    : NextResponse.json({ ok: true })
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    auth: { flowType: "pkce", autoRefreshToken: false, persistSession: false },
    cookies: {
      getAll() {
        return requestCookies
      },
      setAll(cookiesToSet) {
        requestCookies = requestCookies
          .filter(({ name }) => !cookiesToSet.some((cookie) => cookie.name === name))
          .concat(cookiesToSet.map(({ name, value }) => ({ name, value })))
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    const errorCode = error.message.toLowerCase().includes("email not confirmed")
      ? "email_not_confirmed"
      : "invalid_credentials"
    if (isFormRequest) return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(redirect)}&error=${errorCode}`, requestUrl), 303)
    return NextResponse.json({ error: errorCode }, { status: 401 })
  }

  // @supabase/ssr persists the signed-in session from its auth-state
  // listener. Give that listener one turn to publish the Set-Cookie headers
  // before returning the response; this matters for WebKit, which can start
  // the following document navigation before a late cookie mutation lands.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))

  return response
}
