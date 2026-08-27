export function RestaurantDiscoveryResultsLoading() {
  return (
    <section className="restaurant-discovery-content marketing-container restaurant-discovery-results-loading" aria-busy="true" aria-label="Loading restaurants">
      <div className="restaurant-discovery-loading-toolbar" aria-hidden="true">
        <div className="restaurant-discovery-loading-copy">
          <span />
          <span />
        </div>
        <span className="restaurant-discovery-loading-filter" />
      </div>
      <div className="public-restaurant-grid">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="restaurant-discovery-loading-card" />)}
      </div>
    </section>
  )
}
