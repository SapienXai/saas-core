import "server-only"

import { createServerClient } from "@supabase/ssr"
import { createNeonDataClient } from "@sapienx/saas-core/postgres"
import { usesNeonBackend } from "@/lib/backend"
import { getNeonAuth, neonUser } from "@/lib/neon/auth"
import { cookies, headers } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  if (usesNeonBackend()) {
    const session = await getNeonAuth().api.getSession({
      headers: await headers(), query: { disableRefresh: true },
    })
    const user = session?.user.emailVerified ? neonUser(session.user) : null
    const db = () => createNeonDataClient(user
      ? { role: "authenticated", id: user.id, email: user.email }
      : { role: "anon" })
    return {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: (...args: Parameters<ReturnType<typeof db>["from"]>) => db().from(...args),
      rpc: (...args: Parameters<ReturnType<typeof db>["rpc"]>) => db().rpc(...args),
    } as unknown as SupabaseClient
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error("Supabase server authentication is not configured.")

  const cookieStore = await cookies()
  return createServerClient(url, key, {
    auth: { flowType: "pkce", autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "saas-core/server" } },
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
