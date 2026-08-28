import { describe, expect, it, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "../proxy"

const originalRoot = process.env.SAAS_CORE_ROOT_DOMAIN
const originalApp = process.env.SAAS_CORE_APP_DOMAIN

afterEach(() => {
  if (originalRoot === undefined) delete process.env.SAAS_CORE_ROOT_DOMAIN
  else process.env.SAAS_CORE_ROOT_DOMAIN = originalRoot
  if (originalApp === undefined) delete process.env.SAAS_CORE_APP_DOMAIN
  else process.env.SAAS_CORE_APP_DOMAIN = originalApp
})

describe("public hostname route ownership in proxy", () => {
  it("redirects tenant app/auth paths to the canonical app origin, including /app", async () => {
    process.env.SAAS_CORE_ROOT_DOMAIN = "example.com"
    process.env.SAAS_CORE_APP_DOMAIN = "app.example.com"
    const cases = ["/app", "/app/team", "/manage", "/platform", "/login", "/setup", "/auth/callback"]

    for (const pathname of cases) {
      const request = new NextRequest(`https://alpha.example.com${pathname}?ref=instagram`, { headers: { host: "alpha.example.com" } })
      const response = await proxy(request)
      expect(response.status, pathname).toBe(307)
      expect(response.headers.get("location"), pathname).toBe(`https://app.example.com${pathname}?ref=instagram`)
    }
  })

  it("leaves product-owned public paths on the tenant hostname", async () => {
    process.env.SAAS_CORE_ROOT_DOMAIN = "example.com"
    process.env.SAAS_CORE_APP_DOMAIN = "app.example.com"
    const response = await proxy(new NextRequest("https://alpha.example.com/beach?workspace=other", { headers: { host: "alpha.example.com" } }))
    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("leaves custom-domain public paths on the custom hostname", async () => {
    process.env.SAAS_CORE_ROOT_DOMAIN = "example.com"
    process.env.SAAS_CORE_APP_DOMAIN = "app.example.com"
    const response = await proxy(new NextRequest("https://music.customer.example/beach", { headers: { host: "music.customer.example" } }))
    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("applies canonical ownership after URL dot-segment normalization", async () => {
    process.env.SAAS_CORE_ROOT_DOMAIN = "example.com"
    process.env.SAAS_CORE_APP_DOMAIN = "app.example.com"
    const response = await proxy(new NextRequest("https://alpha.example.com/beach/../app?ref=smoke", { headers: { host: "alpha.example.com" } }))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://app.example.com/app?ref=smoke")
  })

  it("protects forwarded-host selection with the shared request boundary", async () => {
    process.env.SAAS_CORE_ROOT_DOMAIN = "example.com"
    process.env.SAAS_CORE_APP_DOMAIN = "app.example.com"
    const response = await proxy(new NextRequest("https://0.0.0.0:3000/app?next=%2Fapp", {
      headers: {
        host: "fallback.example.com",
        "x-forwarded-host": "alpha.example.com, proxy.internal",
      },
    }))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://app.example.com/app?next=%2Fapp")
  })
})
