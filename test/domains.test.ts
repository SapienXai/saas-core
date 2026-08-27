import { describe, expect, it } from "vitest"
import {
  classifyHostname,
  getCustomerHostnameParts,
  HostnameValidationError,
  normalizeDnsTarget,
  normalizeHostname,
} from "../lib/domains/hostname"

describe("Reservevia hostname classification", () => {
  it("recognizes platform and hosted hosts", () => {
    expect(classifyHostname("reservevia.com").kind).toBe("PLATFORM_ROOT")
    expect(classifyHostname("www.reservevia.com").kind).toBe("PLATFORM_WWW")
    expect(classifyHostname("app.reservevia.com").kind).toBe("PLATFORM_APP")
    expect(classifyHostname("Felix-Beach.RESERVEVIA.COM")).toMatchObject({
      kind: "HOSTED_RESTAURANT",
      hostname: "felix-beach.reservevia.com",
      restaurantSlug: "felix-beach",
    })
  })

  it("supports local tenant hosts, ports, and preview hosts", () => {
    expect(classifyHostname("felix-beach.localhost:3000")).toMatchObject({
      kind: "HOSTED_RESTAURANT",
      hostname: "felix-beach.localhost",
      restaurantSlug: "felix-beach",
    })
    expect(classifyHostname("reservevia-git-main.vercel.app").kind).toBe("VERCEL_PREVIEW")
    expect(classifyHostname("land.ngrok-free.dev").kind).toBe("LOCAL_DEVELOPMENT")
    expect(classifyHostname("reservevia.ngrok.app").kind).toBe("LOCAL_DEVELOPMENT")
    expect(classifyHostname("localhost:3000").kind).toBe("LOCAL_DEVELOPMENT")
    expect(classifyHostname("127.0.0.1:3000").kind).toBe("LOCAL_DEVELOPMENT")
    expect(classifyHostname("192.168.1.115:3000").kind).toBe("LOCAL_DEVELOPMENT")
  })

  it("recognizes valid customer domains and rejects platform ownership", () => {
    expect(classifyHostname("booking.restaurant.example").kind).toBe("CUSTOM_RESTAURANT")
    expect(() => normalizeHostname("https://RESERVE.Example.com/")).not.toThrow()
    expect(normalizeHostname("https://RESERVE.Example.com/")).toBe("reserve.example.com")
    expect(normalizeHostname("münich.example")).toContain("xn--")
    expect(() => normalizeHostname("reservevia.com")).toThrow(HostnameValidationError)
    expect(() => normalizeHostname("custom.reservevia.com")).toThrow(HostnameValidationError)
  })

  it("rejects unsafe domain input", () => {
    for (const value of [
      "127.0.0.1",
      "[::1]",
      "*.example.com",
      "localhost:3000",
      "https://example.com/path",
      "example.com/path",
      "https://example.com?x=1",
    ]) {
      expect(() => normalizeHostname(value), value).toThrow(HostnameValidationError)
    }
  })

  it("does not treat platform labels as restaurant slugs", () => {
    expect(classifyHostname("admin.reservevia.com").kind).toBe("UNKNOWN")
    expect(classifyHostname("app.reservevia.com").restaurantSlug).toBeNull()
    expect(classifyHostname("nested.foo.reservevia.com").kind).toBe("UNKNOWN")
  })

  it("derives the DNS host for a subdomain and identifies apex domains", () => {
    expect(getCustomerHostnameParts("booking.felixsmile.com")).toEqual({
      hostname: "booking.felixsmile.com",
      isApex: false,
      dnsHost: "booking",
    })
    expect(getCustomerHostnameParts("felixsmile.com")).toEqual({
      hostname: "felixsmile.com",
      isApex: true,
      dnsHost: "@",
    })
  })

  it("allows a trusted Reservevia DNS target without treating it as a customer domain", () => {
    expect(normalizeDnsTarget("https://CNAME.RESERVEVIA.COM/")).toBe("cname.reservevia.com")
    expect(normalizeDnsTarget("192.0.2.10")).toBeNull()
    expect(normalizeDnsTarget("cname.reservevia.com/path")).toBeNull()
  })
})
