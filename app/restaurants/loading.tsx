import { MarketingLayout } from "@/components/marketing/marketing-layout"
import { RestaurantDiscoveryResultsLoading } from "@/components/restaurant-discovery-results-loading"

export default function RestaurantsLoading() {
  return (
    <MarketingLayout>
      <main className="marketing-directory-page" aria-busy="true" aria-label="Loading restaurants">
        <section className="restaurant-discovery-loading-hero" aria-hidden="true">
          <div className="marketing-container restaurant-discovery-loading-hero-inner">
            <span className="restaurant-discovery-loading-eyebrow" />
            <span className="restaurant-discovery-loading-title" />
            <span className="restaurant-discovery-loading-description" />
            <div className="restaurant-discovery-loading-search" />
          </div>
        </section>
        <RestaurantDiscoveryResultsLoading />
      </main>
    </MarketingLayout>
  )
}
