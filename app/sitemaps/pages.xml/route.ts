import { getPlatformUrl } from "@/lib/platform-urls"

export const dynamic = "force-static"

const pages = [
  ["/", "weekly", "1"],
  ["/restaurants", "daily", "0.9"],
  ["/pricing", "monthly", "0.6"],
  ["/privacy", "monthly", "0.4"],
  ["/terms", "monthly", "0.4"],
] as const

export async function GET() {
  const body = pages.map(([path, frequency, priority]) => `<url><loc>${getPlatformUrl(path)}</loc><changefreq>${frequency}</changefreq><priority>${priority}</priority></url>`).join("")
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } })
}
