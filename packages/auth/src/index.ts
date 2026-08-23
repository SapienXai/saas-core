import { CoreError } from "@sapienx/saas-core"

export type AuthSession = { userId: string; expiresAt: string; aal?: "aal1" | "aal2" }
export type AuthAdapter = {
  getUser(): Promise<{ id: string; email: string } | null>
  getSession(): Promise<AuthSession | null>
  signUp(input: { email: string; password: string; redirectTo: string }): Promise<void>
  signIn(input: { email: string; password: string }): Promise<void>
  signOut(): Promise<void>
  requestPasswordReset(input: { email: string; redirectTo: string }): Promise<void>
}

export type SupabaseAuthClient = {
  auth: {
    getUser(): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: { message: string } | null }>
    getSession(): Promise<{ data: { session: AuthSession | null }; error: { message: string } | null }>
    signUp(input: { email: string; password: string; options: { emailRedirectTo: string } }): Promise<{ error: { message: string } | null }>
    signInWithPassword(input: { email: string; password: string }): Promise<{ error: { message: string } | null }>
    signOut(): Promise<{ error: { message: string } | null }>
    resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<{ error: { message: string } | null }>
  }
}

export function createSupabaseAuthAdapter(client: SupabaseAuthClient): AuthAdapter {
  const unwrap = (error: { message: string } | null) => { if (error) throw new CoreError("CONFIGURATION_ERROR", "Authentication request failed.") }
  return {
    async getUser() { const result = await client.auth.getUser(); if (result.error) return null; return result.data.user ? { id: result.data.user.id, email: result.data.user.email ?? "" } : null },
    async getSession() { const result = await client.auth.getSession(); if (result.error) return null; return result.data.session },
    async signUp(input) { unwrap((await client.auth.signUp({ email: input.email, password: input.password, options: { emailRedirectTo: input.redirectTo } })).error) },
    async signIn(input) { unwrap((await client.auth.signInWithPassword(input)).error) },
    async signOut() { unwrap((await client.auth.signOut()).error) },
    async requestPasswordReset(input) { unwrap((await client.auth.resetPasswordForEmail(input.email, { redirectTo: input.redirectTo })).error) },
  }
}

export async function requireUser(adapter: Pick<AuthAdapter, "getUser">) {
  const user = await adapter.getUser()
  if (!user) throw new CoreError("UNAUTHENTICATED", "Authentication is required.")
  return user
}

export function safeAuthRedirect(value: string | null | undefined, origin: string): string {
  if (!value) return "/"
  try {
    const target = new URL(value, origin)
    const base = new URL(origin)
    if (target.origin !== base.origin) return "/"
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return "/"
  }
}

export function accountState(input: { authenticated: boolean; workspaceCount: number; onboardingComplete?: boolean; suspended?: boolean }): "unauthenticated" | "authenticated_no_workspace" | "onboarding" | "active" | "suspended" {
  if (!input.authenticated) return "unauthenticated"
  if (input.suspended) return "suspended"
  if (input.workspaceCount === 0) return "authenticated_no_workspace"
  if (input.onboardingComplete === false) return "onboarding"
  return "active"
}
