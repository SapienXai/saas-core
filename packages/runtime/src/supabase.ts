import { createBrowserClient, createServerClient, type CookieMethodsServer } from "@supabase/ssr"
import { createClient, type User } from "@supabase/supabase-js"
import { CoreError } from "@sapienx/saas-core"

export type CoreSupabaseClient = ReturnType<typeof createClient>
export type CoreCookie = { name: string; value: string; options?: Record<string, unknown> }
export type CoreCookieStore = {
  getAll(): Array<{ name: string; value: string }>
  set?(name: string, value: string, options?: Record<string, unknown>): void
}

export type SupabaseRuntimeConfig = {
  url: string
  anonKey: string
  serviceRoleKey?: string
}

function assertUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) throw new CoreError("CONFIGURATION_ERROR", "SUPABASE_URL must be an absolute HTTP(S) URL.")
  return value.replace(/\/$/, "")
}

export function getSupabaseRuntimeConfig(env: NodeJS.ProcessEnv = process.env): SupabaseRuntimeConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new CoreError("CONFIGURATION_ERROR", "Supabase URL and anon key are not configured.")
  return { url: assertUrl(url), anonKey, ...(env.SUPABASE_SERVICE_ROLE_KEY ? { serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY } : {}) }
}

export function createBrowserSupabaseClient(config: SupabaseRuntimeConfig = getSupabaseRuntimeConfig()): CoreSupabaseClient {
  return createBrowserClient(config.url, config.anonKey, {
    auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  }) as unknown as CoreSupabaseClient
}

export function createServerSupabaseClient(input: {
  config?: SupabaseRuntimeConfig
  cookies: CookieMethodsServer
}): CoreSupabaseClient {
  const config = input.config ?? getSupabaseRuntimeConfig()
  return createServerClient(config.url, config.anonKey, {
    auth: { flowType: "pkce", autoRefreshToken: true, persistSession: false, detectSessionInUrl: true },
    cookies: input.cookies,
    global: { headers: { "X-Client-Info": "sapienx-saas-core-runtime" } },
  }) as unknown as CoreSupabaseClient
}

export function createNextServerSupabaseClient(cookieStore: CoreCookieStore, config?: SupabaseRuntimeConfig): CoreSupabaseClient {
  let requestCookies = cookieStore.getAll()
  return createServerSupabaseClient({
    ...(config ? { config } : {}),
    cookies: {
      getAll: () => requestCookies,
      setAll: (cookiesToSet) => {
        requestCookies = requestCookies
          .filter(({ name }) => !cookiesToSet.some((cookie) => cookie.name === name))
          .concat(cookiesToSet.map(({ name, value }) => ({ name, value })))
        for (const cookie of cookiesToSet) {
          try { cookieStore.set?.(cookie.name, cookie.value, cookie.options) } catch { /* Server components cannot mutate cookies. */ }
        }
      },
    },
  })
}

export function createServiceRoleSupabaseClient(config: SupabaseRuntimeConfig = getSupabaseRuntimeConfig()): CoreSupabaseClient {
  if (typeof window !== "undefined") throw new CoreError("FORBIDDEN", "The Supabase service-role client is server-only.")
  if (!config.serviceRoleKey) throw new CoreError("CONFIGURATION_ERROR", "SUPABASE_SERVICE_ROLE_KEY is not configured.")
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "sapienx-saas-core-service" } },
  })
}

export async function getCurrentUser(client: Pick<CoreSupabaseClient, "auth">): Promise<User | null> {
  const { data, error } = await client.auth.getUser()
  if (error) return null
  return data.user
}

export async function requireUser(client: Pick<CoreSupabaseClient, "auth">): Promise<User> {
  const user = await getCurrentUser(client)
  if (!user) throw new CoreError("UNAUTHENTICATED", "Authentication is required.")
  return user
}

export function safeRedirect(value: string | null | undefined, origin: string, fallback = "/"): string {
  if (!value) return fallback
  try {
    const target = new URL(value, origin)
    const base = new URL(origin)
    if (target.origin !== base.origin || target.pathname.startsWith("//")) return fallback
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return fallback
  }
}
