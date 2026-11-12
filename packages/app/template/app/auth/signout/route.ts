import { NextResponse } from "next/server"
import { createSupabaseAuthServerClient } from "@/lib/supabase/server"
import { usesNeonBackend } from "@/lib/backend"
import { copyAuthCookies, neonAuthPost } from "@/lib/neon/auth"
import { getRequestUrl } from "@/lib/request-url"

/**
 * Clear the SSR auth cookies as well as the browser client's local session.
 * This is intentionally a navigation endpoint so a logout cannot leave a
 * stale server session behind when the next account signs in in the same
 * browser.
 */
export async function GET(request: Request) {
  if (usesNeonBackend()) {
    const result = await neonAuthPost(request, "sign-out")
    const response = NextResponse.redirect(new URL("/login?logged_out=1", getRequestUrl(request)))
    if (!result.ok) {
      response.cookies.delete("saas-core.session_token")
      response.cookies.delete("__Secure-saas-core.session_token")
    }
    return copyAuthCookies(result, response)
  }
  try {
    const supabase = await createSupabaseAuthServerClient()
    await supabase.auth.signOut({ scope: "local" })
  } catch (error) {
    console.warn("Supabase server sign out failed:", error)
  }

  const response = NextResponse.redirect(new URL("/login?logged_out=1", getRequestUrl(request)))
  response.headers.set("Cache-Control", "no-store, max-age=0")
  return response
}
