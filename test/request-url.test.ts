import { afterEach, describe, expect, it, vi } from "vitest"
import { classifyHostname, getRequestHostname, getTrustedRequestHost } from "../lib/domains/hostname"
import { getAuthRedirectOrigin, getAuthRedirectUrl, getRequestUrl } from "../lib/request-url"

const originalNodeEnv = process.env.NODE_ENV
const environment = process.env as Record<string, string | undefined>

afterEach(() => {
  environment.NODE_ENV = originalNodeEnv
  vi.unstubAllEnvs()
})

describe("trusted request hostname boundary", () => {
  it("uses the first forwarded host when a trusted proxy is configured", () => {
    vi.stubEnv("SAAS_CORE_TRUST_FORWARDED_HOST", "true")
    const request = new Request("http://0.0.0.0:3000/app?next=%2Fapp", {
      headers: {
        host: "fallback.example.com",
        "x-forwarded-host": "alpha.example.com:3100, proxy.internal",
        "x-forwarded-proto": "https",
      },
    })

    expect(getTrustedRequestHost(request)).toEqual({ hostname: "alpha.example.com", host: "alpha.example.com:3100" })
    expect(getRequestHostname(request)).toBe("alpha.example.com")
    expect(getRequestUrl(request).origin).toBe("https://alpha.example.com:3100")
  })

  it("falls back to Host when the forwarded value is malformed", () => {
    vi.stubEnv("SAAS_CORE_TRUST_FORWARDED_HOST", "true")
    const request = new Request("http://0.0.0.0:3000/", {
      headers: {
        host: "alpha.example.com",
        "x-forwarded-host": "https://other.example.com/path",
      },
    })

    expect(getRequestHostname(request)).toBe("alpha.example.com")
  })

  it("ignores an injected forwarded hostname by default", () => {
    vi.stubEnv("SAAS_CORE_TRUST_FORWARDED_HOST", "")
    const request = new Request("http://localhost/", {
      headers: { host: "alpha.example.com", "x-forwarded-host": "other.example.com", "x-forwarded-proto": "https" },
    })
    expect(getRequestHostname(request)).toBe("alpha.example.com")
    expect(getRequestUrl(request).origin).toBe("http://alpha.example.com")
  })

  it("keeps redirect authority when a path looks like a protocol-relative URL", () => {
    const request = new Request("http://0.0.0.0:3000//attacker.example/path?keep=1#anchor", {
      headers: { host: "alpha.example.com" },
    })
    expect(getRequestUrl(request).href).toBe("http://alpha.example.com//attacker.example/path?keep=1#anchor")
    environment.NODE_ENV = "production"
    expect(getAuthRedirectUrl(request).href).toBe("http://0.0.0.0:3000//attacker.example/path?keep=1#anchor")
  })

  it("keeps the request scheme when the trusted proxy protocol is invalid", () => {
    vi.stubEnv("SAAS_CORE_TRUST_FORWARDED_HOST", "true")
    const request = new Request("https://preview.example.test/login", {
      headers: { host: "preview.example.test", "x-forwarded-proto": "javascript, http" },
    })
    expect(getAuthRedirectUrl(request).href).toBe("https://preview.example.test/login")
  })

  it("preserves a private LAN host and the active development port", () => {
    const request = new Request("http://0.0.0.0:3000/auth/signup", {
      headers: { host: "192.168.1.108:3100" },
    })

    expect(getTrustedRequestHost(request)).toEqual({ hostname: "192.168.1.108", host: "192.168.1.108:3100" })
    expect(getRequestUrl(request).origin).toBe("http://192.168.1.108:3100")
  })

  it("uses a same-machine hostname alias for Auth redirects from a LAN host", () => {
    expect(getAuthRedirectOrigin("http://192.168.1.108:3100")).toBe("http://192.168.1.108.nip.io:3100")
    expect(getAuthRedirectOrigin("http://localhost:3100")).toBe("http://localhost:3100")
    expect(getAuthRedirectOrigin("http://192.168.1.108.nip.io:3100")).toBe("http://192.168.1.108.nip.io:3100")
    expect(getAuthRedirectOrigin("http://acme.192.168.1.108.nip.io:3100")).toBe("http://acme.192.168.1.108.nip.io:3100")
    expect(getAuthRedirectUrl(new Request("http://0.0.0.0:3000/login?next=%2Fapp", {
      headers: { host: "acme.192.168.1.108.nip.io:3100" },
    })).toString()).toBe("http://acme.192.168.1.108.nip.io:3100/login?next=%2Fapp")
    expect(classifyHostname("192.168.1.108.nip.io").kind).toBe("PLATFORM_ROOT")
    expect(classifyHostname("app.192.168.1.108.nip.io").kind).toBe("PLATFORM_APP")
    expect(classifyHostname("acme.192.168.1.108.nip.io").kind).toBe("HOSTED_WORKSPACE")
  })

  it("disables the development alias in production", () => {
    environment.NODE_ENV = "production"
    expect(getAuthRedirectOrigin("http://192.168.1.108:3100")).toBe("http://192.168.1.108:3100")
    expect(classifyHostname("acme.192.168.1.108.nip.io").kind).toBe("UNKNOWN")
  })

  it("does not accept credentials, paths, or a scheme as a trusted host", () => {
    for (const value of [
      "https://alpha.example.com",
      "user:password@alpha.example.com",
      "alpha.example.com/path",
      "alpha.example.com?workspace=other",
    ]) {
      const request = new Request("http://0.0.0.0:3000/", { headers: { host: value } })
      expect(getRequestHostname(request), value).toBeNull()
    }
  })
})
