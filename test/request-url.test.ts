import { describe, expect, it } from "vitest"
import { getRequestHostname, getTrustedRequestHost } from "../lib/domains/hostname"
import { getRequestUrl } from "../lib/request-url"

describe("trusted request hostname boundary", () => {
  it("uses the first forwarded host and preserves its port for development URLs", () => {
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
    const request = new Request("http://0.0.0.0:3000/", {
      headers: {
        host: "alpha.example.com",
        "x-forwarded-host": "https://other.example.com/path",
      },
    })

    expect(getRequestHostname(request)).toBe("alpha.example.com")
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
