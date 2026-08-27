import { getPlatformUrl } from "@/lib/platform-urls"

export const dynamic = "force-dynamic"

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;")
}

export async function GET() {
  const origin = getPlatformUrl("/").replace(/\/$/, "")
  const locs = ["/sitemaps/pages.xml"].map((path) => `<sitemap><loc>${xmlEscape(`${origin}${path}`)}</loc></sitemap>`).join("")
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</sitemapindex>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } })
}
