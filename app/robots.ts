import type { MetadataRoute } from "next"
import { getPlatformUrl } from "@/lib/platform-urls"

export const dynamic = "force-dynamic"

export default function robots(): MetadataRoute.Robots { return { rules: [{ userAgent: "*", allow: ["/"], disallow: ["/app", "/platform", "/api"] }], sitemap: getPlatformUrl("/sitemap.xml") } }
