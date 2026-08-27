import { MarketingLayout } from "@/components/marketing/marketing-layout"
import { ConsumerStatePage } from "@/components/consumer-state-page"

export function RestaurantUnavailablePage({ maintenance = false }: { maintenance?: boolean }) {
  return (
    <MarketingLayout>
      <ConsumerStatePage variant={maintenance ? "maintenance" : "unavailable"} />
    </MarketingLayout>
  )
}
