import { afterEach, describe, expect, it } from "vitest"
import { getTrustedPlatformOrigin } from "../lib/domains/hostname"
import { getApplicationOrigin, getApplicationUrl, getPlatformOrigin } from "../lib/platform-urls"

const originalNodeEnv = process.env.NODE_ENV
const environment = process.env as Record<string, string | undefined>

afterEach(() => {
  environment.NODE_ENV = originalNodeEnv
})

describe("development platform origins", () => {
  it("derives root and app origins from a supported nip.io request host", () => {
    environment.NODE_ENV = "development"
    const requestHost = "acme.192.168.1.108.nip.io:3100"

    expect(getTrustedPlatformOrigin("root", { requestHost })).toBe("http://192.168.1.108.nip.io:3100")
    expect(getTrustedPlatformOrigin("app", { requestHost })).toBe("http://app.192.168.1.108.nip.io:3100")
    expect(getPlatformOrigin({ requestHost })).toBe("http://192.168.1.108.nip.io:3100")
    expect(getApplicationOrigin({ requestHost })).toBe("http://app.192.168.1.108.nip.io:3100")
    expect(getApplicationUrl("/login?next=%2Fapp", { requestHost })).toBe("http://app.192.168.1.108.nip.io:3100/login?next=%2Fapp")
  })

  it("converts a raw private request host without changing its active port", () => {
    environment.NODE_ENV = "development"
    expect(getApplicationOrigin({ requestHost: "192.168.1.108:4310" })).toBe("http://app.192.168.1.108.nip.io:4310")
  })

  it("keeps configured production origins authoritative in production", () => {
    environment.NODE_ENV = "production"
    expect(getPlatformOrigin({ requestHost: "acme.192.168.1.108.nip.io:3100", rootDomain: "example.com" })).toBe("https://example.com")
    expect(getApplicationOrigin({ requestHost: "acme.192.168.1.108.nip.io:3100", appDomain: "app.example.com" })).toBe("https://app.example.com")
  })
})
