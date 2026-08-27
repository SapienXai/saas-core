import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error("Supabase server authentication is not configured.")

  const cookieStore = await cookies()
  return createServerClient(url, key, {
    auth: { flowType: "pkce", autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "reservevia/server" } },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Components cannot always mutate cookies. Middleware owns
          // refresh persistence; route handlers/actions can still set them.
        }
      },
    },
  })
}
