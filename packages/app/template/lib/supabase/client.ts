"use client"

import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

import { usesNeonBackend } from "@/lib/backend"
import { neonBrowserAuth } from "@/lib/neon/browser"

let browserClient: SupabaseClient | undefined

export function getSupabaseBrowserClient(): SupabaseClient {
  if (usesNeonBackend()) return { auth: neonBrowserAuth } as unknown as SupabaseClient
  if (browserClient) return browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for browser client.")
  }

  browserClient = createBrowserClient(url, key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      experimental: { appendPkceFlowIdToRedirects: true },
    },
    global: { headers: { "X-Client-Info": "saas-core/browser" } },
  })

  return browserClient
}
