import { getPlatformUrl } from "@/lib/platform-urls"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export const dynamic = "force-static"

type SitemapPage = readonly [path: string, frequency: "weekly" | "monthly", priority: string]

const corePages: readonly SitemapPage[] = [
  ["/", "weekly", "1"],
  ["/login", "monthly", "0.6"],
  ["/signup", "monthly", "0.6"],
]

function isSafePublicPath(path: string): boolean {
  return /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(path)
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;")
}

function getPages(): SitemapPage[] {
  const seen = new Set(corePages.map(([path]) => path))
  const productPages = (PRODUCT_CONFIG.publicSitemapPaths || [])
    .filter((path): path is string => {
      if (typeof path !== "string" || !isSafePublicPath(path) || seen.has(path)) return false
      seen.add(path)
      return true
    })
    .map((path) => [path, "monthly", "0.5"] as const)
  return [...corePages, ...productPages]
}

export async function GET() {
  const body = getPages().map(([path, frequency, priority]) => `<url><loc>${xmlEscape(getPlatformUrl(path))}</loc><changefreq>${frequency}</changefreq><priority>${priority}</priority></url>`).join("")
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } })
}
