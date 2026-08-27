import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getRequestUrl } from "@/lib/request-url"

/**
 * Clear the SSR auth cookies as well as the browser client's local session.
 * This is intentionally a navigation endpoint so a logout cannot leave a
 * stale server session behind when the next account signs in in the same
 * browser.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut({ scope: "local" })
  } catch (error) {
    console.warn("Supabase server sign out failed:", error)
  }

  const response = NextResponse.redirect(new URL("/login?logged_out=1", getRequestUrl(request)))
  response.headers.set("Cache-Control", "no-store, max-age=0")
  return response
}
