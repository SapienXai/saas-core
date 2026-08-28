import { describe, expect, it } from "vitest"
import {
  CORE_CANONICAL_APP_PATHS,
  CORE_RESERVED_PUBLIC_PATHS,
  isCanonicalAppPath,
  isCoreReservedPublicPath,
  normalizeRequestPathname,
} from "../lib/route-ownership"

describe("Core route ownership", () => {
  it("keeps canonical app paths distinct from public product paths", () => {
    expect(CORE_CANONICAL_APP_PATHS).toContain("/app")
    expect(isCanonicalAppPath("/app")).toBe(true)
    expect(isCanonicalAppPath("/app/team")).toBe(true)
    expect(isCanonicalAppPath("/manage")).toBe(true)
    expect(isCanonicalAppPath("/platform/health")).toBe(true)
    expect(isCanonicalAppPath("/login")).toBe(true)
    expect(isCanonicalAppPath("/setup")).toBe(true)
    expect(isCanonicalAppPath("/appetite")).toBe(false)
    expect(isCanonicalAppPath("/beach")).toBe(false)
  })

  it("protects Core public/system namespaces without claiming product paths", () => {
    expect(CORE_RESERVED_PUBLIC_PATHS).toContain("/api")
    expect(isCoreReservedPublicPath("/api/health")).toBe(true)
    expect(isCoreReservedPublicPath("/_next/static/chunk.js")).toBe(true)
    expect(isCoreReservedPublicPath("/manifest.webmanifest")).toBe(true)
    expect(isCoreReservedPublicPath("/sw.js")).toBe(true)
    expect(isCoreReservedPublicPath("/pricing")).toBe(false)
    expect(isCoreReservedPublicPath("/beach")).toBe(false)
  })

  it("uses the URL parser for dot-segment normalization and query separation", () => {
    expect(normalizeRequestPathname("/beach/../app")).toBe("/app")
    expect(normalizeRequestPathname("/beach/%2e%2e/app?ref=instagram")).toBe("/app")
    expect(normalizeRequestPathname("/beach?workspace=other")).toBe("/beach")
    expect(isCanonicalAppPath("/beach/%2e%2e/app")).toBe(true)
    expect(normalizeRequestPathname("https://other.example.com/beach")).toBeNull()
    expect(normalizeRequestPathname("//other.example.com/beach")).toBeNull()
  })
})
