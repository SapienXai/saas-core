import { describe, expect, it, vi } from "vitest"
import { createSupabaseAuthAdapter, safeAuthRedirect } from "./index.js"

describe("auth boundary", () => {
  it("keeps redirects same-origin and rejects external targets", () => {
    expect(safeAuthRedirect("/onboarding?step=1", "https://app.example.com")).toBe("/onboarding?step=1")
    expect(safeAuthRedirect("https://evil.example/phish", "https://app.example.com")).toBe("/")
  })

  it("maps Supabase auth calls without exposing provider errors", async () => {
    const client = { auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u", email: "u@example.test" } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    }}
    const adapter = createSupabaseAuthAdapter(client)
    expect(await adapter.getUser()).toEqual({ id: "u", email: "u@example.test" })
    await adapter.signUp({ email: "u@example.test", password: "secret", redirectTo: "https://app.example.com/auth/confirm" })
    expect(client.auth.signUp).toHaveBeenCalledOnce()
  })
})
