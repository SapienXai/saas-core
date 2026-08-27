import type { MetadataRoute } from "next"
import { getPlatformUrl } from "@/lib/platform-urls"
import { getHostedRestaurantUrl } from "@/lib/domains/public-url"
import { getRequestOrigin } from "@/lib/domains/request-origin"
import { resolvePublicRestaurantRequest } from "@/lib/domains/public-resolver"
import { PRIVATE_CRAWL_PATHS, PUBLIC_CRAWL_PATHS, trainingCrawlerPolicy } from "@/lib/ai/crawler-policy"

export const dynamic = "force-dynamic"

const disallowedPaths = PRIVATE_CRAWL_PATHS

function crawlerRules() {
  const rules: NonNullable<MetadataRoute.Robots["rules"]> = [
    { userAgent: "*", allow: PUBLIC_CRAWL_PATHS, disallow: disallowedPaths },
    { userAgent: "OAI-SearchBot", allow: PUBLIC_CRAWL_PATHS, disallow: disallowedPaths },
  ]
  if (trainingCrawlerPolicy() === "disallow") {
    rules.push({ userAgent: "GPTBot", allow: [], disallow: ["/"] })
    rules.push({ userAgent: "Google-Extended", allow: [], disallow: ["/"] })
  }
  return rules
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const publicRequest = await resolvePublicRestaurantRequest()
  const tenantRequest = publicRequest.kind === "HOSTED_RESTAURANT" || publicRequest.kind === "CUSTOM_RESTAURANT"

  if (tenantRequest && publicRequest.brand && publicRequest.state === "resolved") {
    const origin = await getRequestOrigin()
    return { rules: crawlerRules(), sitemap: new URL("/sitemap.xml", origin).toString() }
  }

  if (tenantRequest && publicRequest.brand && publicRequest.state === "suspended") {
    return { rules: crawlerRules(), sitemap: new URL("/sitemap.xml", getPlatformUrl("/")).toString() }
  }

  if (tenantRequest && publicRequest.state === "resolved" && publicRequest.restaurant) {
    const origin = await getRequestOrigin()
    return {
      rules: crawlerRules(),
      sitemap: new URL("/sitemap.xml", origin).toString(),
    }
  }

  if (tenantRequest && publicRequest.state === "suspended" && publicRequest.restaurant) {
    return {
      rules: crawlerRules(),
      sitemap: new URL("/sitemap.xml", getHostedRestaurantUrl(publicRequest.restaurant.slug)).toString(),
    }
  }

  return {
    rules: crawlerRules(),
    sitemap: getPlatformUrl("/sitemap.xml"),
  }
}
