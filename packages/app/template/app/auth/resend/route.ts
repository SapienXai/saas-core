import { NextResponse } from "next/server"
import { createSupabaseAuthServerClient } from "@/lib/supabase/server"
import { usesNeonBackend } from "@/lib/backend"
import { neonAuthOrigin, neonAuthPost } from "@/lib/neon/auth"
import { safeInternalRedirect } from "@/lib/account-state"
import { getAuthRedirectUrl } from "@/lib/request-url"

type ResendBody = {
  email?: unknown
  redirect?: unknown
}

export async function POST(request: Request) {
  let body: ResendBody
  try {
    body = await request.json() as ResendBody
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const email = typeof body.email === "string" ? body.email.trim() : ""
  if (!email) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  const origin = getAuthRedirectUrl(request).origin
  const redirect = safeInternalRedirect(typeof body.redirect === "string" ? body.redirect : null, "/onboarding")
  if (usesNeonBackend()) {
    const callbackURL = new URL(`/auth/continue?redirect=${encodeURIComponent(redirect)}`, neonAuthOrigin()).href
    const result = await neonAuthPost(request, "send-verification-email", { email, callbackURL })
    if (!result.ok) return NextResponse.json({ error: result.status === 429 ? "email_rate_limited" : "resend_failed" }, { status: result.status === 429 ? 429 : 400 })
    return NextResponse.json({ ok: true })
  }
  const supabase = await createSupabaseAuthServerClient()
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(redirect)}` },
  })
  if (error) {
    const emailRateLimited = error.code === "over_email_send_rate_limit"
    return NextResponse.json(
      { error: emailRateLimited ? "email_rate_limited" : "resend_failed" },
      { status: emailRateLimited ? 429 : 400 },
    )
  }

  return NextResponse.json({ ok: true })
}
