import { getPlatformUrl } from "@/lib/platform-urls"
import { fetchPublicRestaurantSitemapEntries } from "@/lib/services/public/restaurant-service"

export const dynamic = "force-dynamic"

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;")
}

export async function GET() {
  const entries = await fetchPublicRestaurantSitemapEntries()
  const body = entries.map((entry) => `<url><loc>${xmlEscape(getPlatformUrl(`/r/${encodeURIComponent(entry.slug)}`))}</loc>${entry.updatedAt ? `<lastmod>${xmlEscape(entry.updatedAt)}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.8</priority></url>`).join("")
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } })
}
