import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { getPwaIconAssetUrl, getPwaIconVersion, getRestaurantPwaIcon, PWA_FALLBACK_ICON } from "../lib/pwa"
import { getAssetVersion } from "../lib/asset-version"
import { getPwaInstallPromptPreferenceKey, getPwaInstallScope, getPwaInstalledScopeKey } from "../lib/pwa-install"
import { isManagementPwaOrigin } from "../lib/pwa-origin"

describe("Reservevia management PWA boundaries", () => {
  it("only treats the management origin and safe development hosts as PWA origins", () => {
    expect(isManagementPwaOrigin("app.reservevia.com")).toBe(true)
    expect(isManagementPwaOrigin("APP.RESERVEVIA.COM.")).toBe(true)
    expect(isManagementPwaOrigin("localhost")).toBe(true)
    expect(isManagementPwaOrigin("reservevia.com")).toBe(false)
    expect(isManagementPwaOrigin("felix-beach.reservevia.com")).toBe(false)
    expect(isManagementPwaOrigin("restaurant.example.com")).toBe(false)
  })

  it("keeps authenticated management data out of service-worker caches", () => {
    const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8")
    expect(serviceWorker).toContain("request.mode === \"navigate\"")
    expect(serviceWorker).toContain("event.respondWith(fetch(request).catch(() => offlineResponse()))")
    expect(serviceWorker).toContain("function isSafeStaticAsset")
    expect(serviceWorker).toContain("/icon-512.png")
    expect(serviceWorker).not.toContain("/assets/sapienx.png")
    expect(serviceWorker).not.toContain("/api/")
    expect(serviceWorker).toContain("You're offline")
  })

  it("uses the restaurant logo for the management app icon", () => {
    expect(PWA_FALLBACK_ICON).toBe("/icon-512.png")
    expect(getRestaurantPwaIcon({ logo_url: "https://cdn.example/logo.png", primary_image_url: "https://cdn.example/hero.jpg" })).toBe("https://cdn.example/logo.png")
    expect(getRestaurantPwaIcon({ logo_url: null, primary_image_url: "https://cdn.example/hero.jpg" })).toBe("https://cdn.example/hero.jpg")
    expect(getRestaurantPwaIcon({ logo_url: "/assets/felix.png", primary_image_url: null })).toBe(PWA_FALLBACK_ICON)
    expect(getRestaurantPwaIcon({ logo_url: null, primary_image_url: "/assets/beach1.jpeg" })).toBe(PWA_FALLBACK_ICON)
    expect(getRestaurantPwaIcon({ logo_url: null, primary_image_url: null })).toBe(PWA_FALLBACK_ICON)
  })

  it("keeps the manifest workspace-scoped and restaurant-brand aware", () => {
    const route = readFileSync(new URL("../app/manifest.webmanifest/route.ts", import.meta.url), "utf8")
    const iconRoute = readFileSync(new URL("../app/pwa/icon/route.ts", import.meta.url), "utf8")
    const layout = readFileSync(new URL("../app/manage/layout.tsx", import.meta.url), "utf8")
    const rootLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8")
    expect(route).toContain('searchParams.get("workspace")')
    expect(route).toContain('searchParams.get("restaurant")')
    expect(route).toContain("context?.memberships.find")
    expect(route).toContain("getPublicPwaBranding")
    expect(route).toContain('src: "/icon-192.png"')
    expect(route).toContain('src: "/icon-512.png"')
    expect(route).toContain("getPwaIconAssetUrl(branding, 192)")
    expect(route).toContain("getPwaIconAssetUrl(branding, 512)")
    expect(route).toContain('purpose: "any maskable"')
    expect(route).not.toContain("...fallbackIcons")
    expect(iconRoute).toContain('storagePathFromPublicUrl(branding.iconUrl)')
    expect(iconRoute).toContain('"Content-Type"')
    expect(iconRoute).toContain('import sharp from "sharp"')
    expect(iconRoute).toContain(".resize(contentSize, contentSize")
    const iconVersion = getAssetVersion("https://cdn.example/logo.png", null)
    expect(getPwaIconVersion({ iconUrl: "https://cdn.example/logo.png" })).toBe(iconVersion)
    expect(getPwaIconAssetUrl({ workspaceId: "workspace-1", restaurantId: "restaurant-1", iconUrl: "https://cdn.example/logo.png" }, 192)).toBe(
      `/pwa/icon?workspace=workspace-1&restaurant=restaurant-1&size=192&v=${iconVersion}&render=2`,
    )
    expect(getPwaIconAssetUrl({ workspaceId: "workspace-1", restaurantId: "restaurant-1", iconUrl: PWA_FALLBACK_ICON })).toBe(PWA_FALLBACK_ICON)
    expect(route).toContain('"Content-Type": "application/manifest+json; charset=utf-8"')
    expect(layout).toContain("/manifest.webmanifest?")
    expect(layout).toContain('manifestParams.set("restaurant", branding.restaurantId)')
    expect(layout).toContain("title: branding.appName")
    const installContext = readFileSync(new URL("../context/manage-pwa-install-context.tsx", import.meta.url), "utf8")
    expect(rootLayout).toContain('id="reservevia-pwa-install-capture"')
    expect(rootLayout).toContain("beforeinstallprompt")
    expect(installContext).toContain("__reserveviaBeforeInstallPrompt")
  })

  it("scopes install prompt preferences by account and workspace", () => {
    const firstAccount = getPwaInstallPromptPreferenceKey("user-1", "workspace-1")
    const secondAccount = getPwaInstallPromptPreferenceKey("user-2", "workspace-1")
    const secondWorkspace = getPwaInstallPromptPreferenceKey("user-1", "workspace-2")
    const firstRestaurant = getPwaInstallPromptPreferenceKey("user-1", "workspace-1", "restaurant-1")
    const secondRestaurant = getPwaInstallPromptPreferenceKey("user-1", "workspace-1", "restaurant-2")

    expect(firstAccount).not.toBe(secondAccount)
    expect(firstAccount).not.toBe(secondWorkspace)
    expect(firstRestaurant).not.toBe(secondRestaurant)
    expect(getPwaInstallPromptPreferenceKey("user-1", null)).toBeTruthy()
    expect(getPwaInstallPromptPreferenceKey(null, "workspace-1")).toBeNull()
    expect(getPwaInstalledScopeKey(getPwaInstallScope("user-1", "workspace-1", "restaurant-1"))).not.toBe(
      getPwaInstalledScopeKey(getPwaInstallScope("user-1", "workspace-1", "restaurant-2")),
    )
  })
})
