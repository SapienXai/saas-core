import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getRequestUrl } from "@/lib/request-url"

type SignUpBody = {
  email?: unknown
  password?: unknown
  redirect?: unknown
}

const formRequest = (request: Request) => request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")

function safeRedirect(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/onboarding"
}

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
  const redirect = safeRedirect(body.redirect)
  if (!email || !password) {
    if (isFormRequest) return NextResponse.redirect(new URL(`/signup?redirect=${encodeURIComponent(redirect)}&error=invalid_request`, request.url), 303)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const origin = getRequestUrl(request).origin
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(redirect)}` },
  })
  if (error) {
    if (isFormRequest) return NextResponse.redirect(new URL(`/signup?redirect=${encodeURIComponent(redirect)}&error=create_failed`, request.url), 303)
    return NextResponse.json({ error: "create_failed" }, { status: 400 })
  }

  if (isFormRequest) return NextResponse.redirect(new URL(`/signup?redirect=${encodeURIComponent(redirect)}&confirmation=sent`, request.url), 303)

  return NextResponse.json({ ok: true })
}
