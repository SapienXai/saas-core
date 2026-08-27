import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { lookup, upload, remove, getPublicUrl, from, createServiceRoleClient } = vi.hoisted(() => ({
  lookup: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  from: vi.fn(),
  createServiceRoleClient: vi.fn(),
}))
let updateValues: Record<string, string> | null = null

vi.mock("node:dns/promises", () => ({ lookup }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient }))

import { assertSafeOfficialWebsiteUrl, fetchVerifiedWebsiteImage, syncRestaurantWebsiteAssets } from "@/lib/restaurant-website-assets"

const logoBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

function response(contentType: string, bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": contentType, "content-length": String(bytes.byteLength) }),
    body: null,
    arrayBuffer: async () => bytes.buffer,
  }
}

describe("restaurant website asset sync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateValues = null
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
    upload.mockResolvedValue({ error: null })
    remove.mockResolvedValue({ error: null })
    getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }))
    from.mockImplementation((table: string) => {
      if (table === "restaurants") return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { logo_url: null, primary_image_url: null }, error: null }) }) }),
        update: (values: Record<string, string>) => ({ eq: async () => { updateValues = values; return { error: null } } }),
      }
      return { storage: true }
    })
    createServiceRoleClient.mockReturnValue({ from, storage: { from: () => ({ upload, remove, getPublicUrl }) } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it("downloads validated logo and banner candidates into restaurant storage", async () => {
    const html = `<html><head><meta property="og:logo" content="/logo.png"><meta property="og:image" content="/cover.jpg"><title>Mikla</title></head><body></body></html>`
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response("text/html", new TextEncoder().encode(html)))
      .mockResolvedValueOnce(response("image/png", logoBytes))
      .mockResolvedValueOnce(response("image/jpeg", jpegBytes)))

    const result = await syncRestaurantWebsiteAssets({ restaurantId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222", officialWebsiteUrl: "https://example.com" })

    expect(result.logo.status).toBe("imported")
    expect(result.primary.status).toBe("imported")
    expect(upload).toHaveBeenCalledTimes(2)
    expect(updateValues).toEqual({ logo_url: expect.stringContaining("/logo/"), primary_image_url: expect.stringContaining("/primary/") })
  })

  it("rejects a candidate that is not a supported image", async () => {
    const html = `<html><head><meta property="og:logo" content="/logo.png"><meta property="og:image" content="/cover.jpg"></head></html>`
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response("text/html", new TextEncoder().encode(html)))
      .mockResolvedValueOnce(response("text/plain", new TextEncoder().encode("not an image")))
      .mockResolvedValueOnce(response("image/jpeg", jpegBytes)))

    const result = await syncRestaurantWebsiteAssets({ restaurantId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222", officialWebsiteUrl: "https://example.com" })

    expect(result.logo.status).toBe("not_found")
    expect(result.primary.status).toBe("imported")
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it("does not fetch an image from a private host", async () => {
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    const html = `<html><head><meta property="og:image" content="http://127.0.0.1/cover.jpg"></head></html>`
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("text/html", new TextEncoder().encode(html))))

    const result = await syncRestaurantWebsiteAssets({ restaurantId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222", officialWebsiteUrl: "https://example.com" })

    expect(result.primary.status).toBe("not_found")
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(upload).not.toHaveBeenCalled()
  })

  it("rejects private official sites before navigation", async () => {
    await expect(assertSafeOfficialWebsiteUrl("http://127.0.0.1/internal", "example.com")).rejects.toThrow("private or unsupported")
  })

  it("rejects an image redirect outside the verified official domain", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://evil.example/asset.jpg" }),
      body: null,
    }))
    await expect(fetchVerifiedWebsiteImage("https://example.com/asset.jpg", { expectedDomain: "example.com" })).rejects.toThrow("outside its verified official domain")
  })
})
