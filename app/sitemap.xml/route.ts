import { getPlatformUrl } from "@/lib/platform-urls"
import { getRequestOrigin } from "@/lib/domains/request-origin"
import { resolvePublicRestaurantRequest } from "@/lib/domains/public-resolver"

export const dynamic = "force-dynamic"

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;")
}

export async function GET() {
  const publicRequest = await resolvePublicRestaurantRequest()
  const tenantRequest = publicRequest.kind === "HOSTED_RESTAURANT" || publicRequest.kind === "CUSTOM_RESTAURANT"
  const origin = tenantRequest ? await getRequestOrigin() : getPlatformUrl("/").replace(/\/$/, "")
  if (tenantRequest && publicRequest.brand && publicRequest.state === "resolved") {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${xmlEscape(`${origin}/`)}</loc></url></urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } })
  }
  if (tenantRequest && publicRequest.restaurant && publicRequest.state === "resolved") {
    const lastModified = publicRequest.restaurant.updatedAt ? `<lastmod>${xmlEscape(publicRequest.restaurant.updatedAt)}</lastmod>` : ""
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${xmlEscape(`${origin}/`)}</loc>${lastModified}</url></urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } })
  }
  const locs = ["/sitemaps/pages.xml", "/sitemaps/restaurants.xml", "/sitemaps/docs.xml"].map((path) => `<sitemap><loc>${xmlEscape(`${origin}${path}`)}</loc></sitemap>`).join("")
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</sitemapindex>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } })
}
