import { afterEach, describe, expect, it } from "vitest"
import { isManagementPwaOrigin } from "../lib/pwa-origin"

const originalNodeEnv = process.env.NODE_ENV
const originalAppDomain = process.env.NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN
const environment = process.env as Record<string, string | undefined>

afterEach(() => {
  environment.NODE_ENV = originalNodeEnv
  if (originalAppDomain === undefined) delete process.env.NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN
  else process.env.NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN = originalAppDomain
})

describe("management PWA origins", () => {
  it("accepts the canonical nip.io app host and local development hosts", () => {
    environment.NODE_ENV = "development"
    expect(isManagementPwaOrigin("app.127.0.0.1.nip.io")).toBe(true)
    expect(isManagementPwaOrigin("192.168.1.108")).toBe(true)
    expect(isManagementPwaOrigin("acme.192.168.1.108.nip.io")).toBe(false)
  })

  it("does not trust nip.io as a PWA origin in production", () => {
    environment.NODE_ENV = "production"
    process.env.NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN = "app.example.com"
    expect(isManagementPwaOrigin("app.127.0.0.1.nip.io")).toBe(false)
    expect(isManagementPwaOrigin("app.example.com")).toBe(true)
  })
})
