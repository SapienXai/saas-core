import { getPlatformUrl } from "@/lib/platform-urls"

export const dynamic = "force-static"

export async function GET() {
  const paths = ["/docs", "/docs/agents", "/docs/api", "/docs/mcp", "/docs/openai"]
  const body = paths.map((path) => `<url><loc>${getPlatformUrl(path)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`).join("")
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } })
}
