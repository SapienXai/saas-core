import type { Metadata } from "next"
import { Suspense } from "react"
import { MarketingLayout } from "@/components/marketing/marketing-layout"
import { RestaurantGrid } from "@/components/restaurant-grid"
import { RestaurantDiscoveryHero } from "@/components/restaurant-discovery-hero"
import { RestaurantDiscoveryResultsLoading } from "@/components/restaurant-discovery-results-loading"
import { requireMarketingHost } from "@/lib/marketing/host"
import { fetchPublicRestaurantDirectory } from "@/lib/services/manage/restaurant-service"
import {
  parseRestaurantDiscoveryQuery,
  type RestaurantDiscoveryResult,
  type RestaurantDiscoverySearchParams,
} from "@/lib/restaurant-discovery"
import { getPlatformUrl } from "@/lib/platform-urls"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"

type RestaurantsPageProps = {
  searchParams: Promise<RestaurantDiscoverySearchParams>
}

async function RestaurantDiscoveryResults({ query }: { query: ReturnType<typeof parseRestaurantDiscoveryQuery> }) {
  let result: RestaurantDiscoveryResult = {
    restaurants: [],
    total: 0,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: 0,
    nextCursor: null,
    hasMore: false,
    query,
  }
  let loadError = false

  try {
    result = await fetchPublicRestaurantDirectory(query)
  } catch (error) {
    console.error("Could not load restaurant discovery page:", error)
    loadError = true
  }

  return <RestaurantGrid result={result} loadError={loadError} />
}

export async function generateMetadata({ searchParams }: RestaurantsPageProps): Promise<Metadata> {
  const language = await getServerLanguage()
  const query = parseRestaurantDiscoveryQuery(await searchParams)
  const hasFilters = Boolean(query.q || query.location || query.cuisine || query.atmosphere || query.page > 1)
  return {
    title: translateServer(language, "public.directory.metaTitle"),
    description: translateServer(language, "public.directory.metaDescription"),
    alternates: { canonical: getPlatformUrl("/restaurants") },
    robots: { index: !hasFilters, follow: true },
  }
}

export default async function RestaurantsPage({ searchParams }: RestaurantsPageProps) {
  await requireMarketingHost()
  const language = await getServerLanguage()
  const query = parseRestaurantDiscoveryQuery(await searchParams)

  return (
    <MarketingLayout>
      <main className="marketing-directory-page" data-language={language}>
        <RestaurantDiscoveryHero query={query} />
        <Suspense fallback={<RestaurantDiscoveryResultsLoading />}>
          <RestaurantDiscoveryResults query={query} />
        </Suspense>
      </main>
    </MarketingLayout>
  )
}
