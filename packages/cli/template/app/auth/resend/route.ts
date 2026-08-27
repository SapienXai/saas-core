import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getRequestUrl } from "@/lib/request-url"

type ResendBody = {
  email?: unknown
  redirect?: unknown
}

function safeRedirect(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/onboarding"
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

  const origin = getRequestUrl(request).origin
  const redirect = safeRedirect(body.redirect)
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(redirect)}` },
  })
  if (error) return NextResponse.json({ error: "resend_failed" }, { status: 400 })

  return NextResponse.json({ ok: true })
}
