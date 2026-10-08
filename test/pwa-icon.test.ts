import { describe, expect, it } from "vitest"
import { getPwaIconMimeType, resolvePwaFallbackIconPath } from "../lib/pwa-icon"

describe("PWA fallback icon configuration", () => {
  it("uses the configured 192px icon only for the small manifest entry", () => {
    expect(resolvePwaFallbackIconPath("/product-icon.png", "/product-icon-192.png", 192)).toBe("/product-icon-192.png")
    expect(resolvePwaFallbackIconPath("/product-icon.png", "/product-icon-192.png", 512)).toBe("/product-icon.png")
  })

  it("falls back to the regular icon for unsafe or missing overrides", () => {
    for (const iconPath192 of [undefined, "", " https://example.test/icon.png ", "//example.test/icon.png", "/\\example.test/icon.png"]) {
      expect(resolvePwaFallbackIconPath("/product-icon.png", iconPath192, 192)).toBe("/product-icon.png")
    }
  })

  it("sets the MIME type from the asset extension without a query string", () => {
    expect(getPwaIconMimeType("/icon.svg?v=1")).toBe("image/svg+xml")
    expect(getPwaIconMimeType("/icon.webp")).toBe("image/webp")
    expect(getPwaIconMimeType("/icon.png")).toBe("image/png")
  })
})
