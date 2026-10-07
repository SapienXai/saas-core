import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), account: vi.fn(), access: vi.fn() }))
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], get: () => undefined }) }))
vi.mock("@supabase/ssr", () => ({ createServerClient: (_url: string, _key: string, options: any) => ({ auth: { signInWithPassword: async (body: unknown) => {
  const result = await mocks.signIn(body)
  if (!result.error) options.cookies.setAll([{ name: "sb-test-auth-token", value: "test-session", options: { httpOnly: true } }])
  return result
} } }) }))
vi.mock("@/lib/account-state", () => ({ getAccountState: mocks.account, safeInternalRedirect: (value: string, fallback: string) => value?.startsWith("/") && !value.startsWith("//") ? value : fallback }))
vi.mock("@/lib/auth-utils", () => ({ getCurrentUserAccess: mocks.access }))
vi.mock("@/lib/product-shell", () => ({ getProductHomePath: () => "/app/overview" }))
import { POST } from "../app/auth/signin/route"
import { GET } from "../app/auth/continue/route"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key")
  mocks.signIn.mockResolvedValue({ error: null })
  mocks.account.mockResolvedValue({ authenticated: true, path: "/app", workspaceId: "workspace" })
})

describe("auth transition responses", () => {
  it("publishes session cookies before the JSON sign-in response", async () => {
    const response = await POST(new Request("https://app.example.com/auth/signin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "test@example.com", password: "test-only" }) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get("set-cookie")).toContain("sb-test-auth-token=test-session")
  })
  it("keeps native form navigation visible and script-safe", async () => {
    const response = await POST(new Request("https://app.example.com/auth/signin", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "test@example.com", password: "test-only", redirect: "/app?q=</script>" }) }))
    const html = await response.text()
    expect(html).toContain('role="status"')
    expect(html).toContain("Opening your workspace")
    expect(html).not.toContain("q=</script>")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
  it("returns a recoverable failure instead of a successful navigation", async () => {
    mocks.signIn.mockResolvedValue({ error: { message: "Invalid login credentials" } })
    const response = await POST(new Request("https://app.example.com/auth/signin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "test@example.com", password: "wrong" }) }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "invalid_credentials" })
  })
  it("continues directly to product home, preserving explicit destinations", async () => {
    expect((await GET(new Request("https://app.example.com/auth/continue?redirect=/app"))).headers.get("location")).toBe("https://app.example.com/app/overview")
    expect((await GET(new Request("https://app.example.com/auth/continue?redirect=/app/team"))).headers.get("location")).toBe("https://app.example.com/app/team")
  })
  it("preserves onboarding and unauthenticated guards", async () => {
    mocks.account.mockResolvedValue({ authenticated: true, path: "/onboarding", workspaceId: null })
    expect((await GET(new Request("https://app.example.com/auth/continue"))).headers.get("location")).toBe("https://app.example.com/onboarding")
    mocks.account.mockResolvedValue({ authenticated: false, path: "/login" })
    expect((await GET(new Request("https://app.example.com/auth/continue"))).headers.get("location")).toContain("/login?")
  })
})
