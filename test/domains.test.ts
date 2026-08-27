import { describe, expect, it } from "vitest"
import {
  classifyHostname,
  getCustomerHostnameParts,
  HostnameValidationError,
  normalizeDnsTarget,
  normalizeHostname,
} from "../lib/domains/hostname"

describe("Core hostname classification", () => {
  it("recognizes platform and hosted hosts", () => {
    expect(classifyHostname("saas.example.com").kind).toBe("PLATFORM_ROOT")
    expect(classifyHostname("www.saas.example.com").kind).toBe("PLATFORM_WWW")
    expect(classifyHostname("app.saas.example.com").kind).toBe("PLATFORM_APP")
    expect(classifyHostname("projects.saas.example.com")).toMatchObject({
      kind: "HOSTED_WORKSPACE",
      hostname: "projects.saas.example.com",
      workspaceSlug: "projects",
    })
  })

  it("supports local tenant hosts, ports, and preview hosts", () => {
    expect(classifyHostname("projects.localhost:3000")).toMatchObject({
      kind: "LOCAL_DEVELOPMENT",
      hostname: "projects.localhost",
    })
    expect(classifyHostname("core-git-main.vercel.app").kind).toBe("VERCEL_PREVIEW")
    expect(classifyHostname("land.ngrok-free.dev").kind).toBe("LOCAL_DEVELOPMENT")
    expect(classifyHostname("saas-core.ngrok.app").kind).toBe("LOCAL_DEVELOPMENT")
    expect(classifyHostname("localhost:3000").kind).toBe("LOCAL_DEVELOPMENT")
    expect(classifyHostname("127.0.0.1:3000").kind).toBe("LOCAL_DEVELOPMENT")
    expect(classifyHostname("192.168.1.115:3000").kind).toBe("LOCAL_DEVELOPMENT")
  })

  it("recognizes valid customer domains and rejects platform ownership", () => {
    expect(classifyHostname("tenant.project.example").kind).toBe("CUSTOM_WORKSPACE")
    expect(() => normalizeHostname("https://RESERVE.Example.com/")).not.toThrow()
    expect(normalizeHostname("https://RESERVE.Example.com/")).toBe("reserve.example.com")
    expect(normalizeHostname("münich.example")).toContain("xn--")
    expect(() => normalizeHostname("saas.example.com")).toThrow(HostnameValidationError)
    expect(() => normalizeHostname("custom.saas.example.com")).toThrow(HostnameValidationError)
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

  it("does not treat platform labels as workspace slugs", () => {
    expect(classifyHostname("admin.saas.example.com").kind).toBe("UNKNOWN")
    expect(classifyHostname("app.saas.example.com").workspaceSlug).toBeNull()
    expect(classifyHostname("nested.foo.saas.example.com").kind).toBe("UNKNOWN")
  })

  it("derives the DNS host for a subdomain and identifies apex domains", () => {
    expect(getCustomerHostnameParts("workspace.example.com")).toEqual({
      hostname: "workspace.example.com",
      isApex: false,
      dnsHost: "workspace",
    })
    expect(getCustomerHostnameParts("example.com")).toEqual({
      hostname: "example.com",
      isApex: true,
      dnsHost: "@",
    })
  })

  it("allows a trusted platform DNS target without treating it as a customer domain", () => {
    expect(normalizeDnsTarget("https://CNAME.SAAS.EXAMPLE.COM/")).toBe("cname.saas.example.com")
    expect(normalizeDnsTarget("192.0.2.10")).toBeNull()
    expect(normalizeDnsTarget("cname.saas.example.com/path")).toBeNull()
  })
})
