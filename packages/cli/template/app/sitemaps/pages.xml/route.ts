import { getPlatformUrl } from "@/lib/platform-urls"

export const dynamic = "force-static"

const pages = [
  ["/", "weekly", "1"],
  ["/login", "monthly", "0.6"],
  ["/signup", "monthly", "0.6"],
] as const

export async function GET() {
  const body = pages.map(([path, frequency, priority]) => `<url><loc>${getPlatformUrl(path)}</loc><changefreq>${frequency}</changefreq><priority>${priority}</priority></url>`).join("")
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } })
}
