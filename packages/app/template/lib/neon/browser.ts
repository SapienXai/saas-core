"use client"

async function authRequest(path: string, body?: object) {
  try {
    const response = await fetch("/api/core-auth/" + path, {
      cache: "no-store",
      ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    })
    const data = await response.json().catch(() => null)
    return response.ok ? { data, error: null } : { data: null, error: new Error("Authentication request failed.") }
  } catch {
    return { data: null, error: new Error("Authentication service is unavailable.") }
  }
}

export const neonBrowserAuth = {
  async getUser() {
    const { data, error } = await authRequest("get-session")
    const user = data?.user
    return { data: { user: user?.emailVerified ? { email: user.email, email_confirmed_at: user.createdAt } : null }, error }
  },
  // The confirmation form polls getUser and checks it on window focus.
  onAuthStateChange() {
    return { data: { subscription: { unsubscribe() {} } } }
  },
  signOut: () => authRequest("sign-out", {}),
  resetPasswordForEmail: (email: string) => authRequest("request-password-reset", {
    email, redirectTo: new URL("/reset-password", window.location.origin).href,
  }),
  updateUser: ({ password }: { password: string }) => authRequest("reset-password", {
    newPassword: password, token: new URL(window.location.href).searchParams.get("token") ?? "",
  }),
  async signInWithOAuth({ provider, options }: { provider: string; options?: { redirectTo?: string } }) {
    const requested = options?.redirectTo && new URL(options.redirectTo, window.location.origin)
    const redirect = requested && requested.searchParams.get("next") || "/app"
    const callbackURL = new URL("/auth/continue", window.location.origin)
    callbackURL.searchParams.set("redirect", redirect)
    const { data, error } = await authRequest("sign-in/social", { provider, callbackURL: callbackURL.href })
    if (data?.url && typeof data.url === "string") window.location.assign(data.url)
    return { data, error }
  },
}
