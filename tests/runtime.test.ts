import { describe, expect, it } from "vitest"
import { getSupabaseRuntimeConfig, safeRedirect } from "../packages/runtime/src/supabase.js"

describe("Supabase runtime boundary", () => {
  it("normalizes same-origin redirects and blocks external targets", () => {
    expect(safeRedirect("/app?workspace=one", "https://saas.example.com")).toBe("/app?workspace=one")
    expect(safeRedirect("https://saas.example.com/app", "https://saas.example.com")).toBe("/app")
    expect(safeRedirect("https://evil.example/phish", "https://saas.example.com")).toBe("/")
    expect(safeRedirect("//evil.example/phish", "https://saas.example.com")).toBe("/")
  })

  it("requires Supabase credentials and never invents defaults", () => {
    expect(() => getSupabaseRuntimeConfig({})).toThrow(/not configured/i)
    expect(getSupabaseRuntimeConfig({ SUPABASE_URL: "https://db.example.com/", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" })).toEqual({ url: "https://db.example.com", anonKey: "anon", serviceRoleKey: "service" })
  })
})
