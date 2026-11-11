import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { usesNeonBackend } from "@/lib/backend"
import { neonAuthOrigin, neonAuthPost } from "@/lib/neon/auth"
import { safeInternalRedirect } from "@/lib/account-state"
import { getAuthRedirectUrl, getRequestUrl } from "@/lib/request-url"
import { getProductOnboardingPath, isDeferredWorkspaceProvisioning } from "@/lib/product-config"

type SignUpBody = {
  email?: unknown
  password?: unknown
  redirect?: unknown
}

const formRequest = (request: Request) => request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")

export async function POST(request: Request) {
  let body: SignUpBody
  const isFormRequest = formRequest(request)
  try {
    body = isFormRequest
      ? Object.fromEntries((await request.formData()).entries())
      : await request.json() as SignUpBody
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const email = typeof body.email === "string" ? body.email.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  const redirect = safeInternalRedirect(typeof body.redirect === "string" ? body.redirect : null, isDeferredWorkspaceProvisioning() ? getProductOnboardingPath() : "/onboarding")
  const requestUrl = getRequestUrl(request)
  if (!email || !password) {
    if (isFormRequest) return NextResponse.redirect(new URL(`/signup?redirect=${encodeURIComponent(redirect)}&error=invalid_request`, requestUrl), 303)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (usesNeonBackend()) {
    const callbackURL = new URL(`/auth/continue?redirect=${encodeURIComponent(redirect)}`, neonAuthOrigin())
    const result = await neonAuthPost(request, "sign-up/email", { email, password, name: email.split("@")[0], callbackURL: callbackURL.href })
    if (!result.ok) {
      const code = result.status === 429 ? "email_rate_limited" : "create_failed"
      if (isFormRequest) return NextResponse.redirect(new URL(`/signup?redirect=${encodeURIComponent(redirect)}&error=${code}`, requestUrl), 303)
      return NextResponse.json({ error: code }, { status: result.status === 429 ? 429 : 400 })
    }
    if (isFormRequest) return NextResponse.redirect(new URL(`/signup?redirect=${encodeURIComponent(redirect)}&confirmation=sent`, requestUrl), 303)
    return NextResponse.json({ ok: true })
  }

  const origin = getAuthRedirectUrl(request).origin
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(redirect)}` },
  })
  if (error) {
    const emailRateLimited = error.code === "over_email_send_rate_limit"
    const errorCode = emailRateLimited ? "email_rate_limited" : "create_failed"
    if (isFormRequest) return NextResponse.redirect(new URL(`/signup?redirect=${encodeURIComponent(redirect)}&error=${errorCode}`, requestUrl), 303)
    return NextResponse.json({ error: errorCode }, { status: emailRateLimited ? 429 : 400 })
  }

  if (isFormRequest) return NextResponse.redirect(new URL(`/signup?redirect=${encodeURIComponent(redirect)}&confirmation=sent`, requestUrl), 303)

  return NextResponse.json({ ok: true })
}
