"use client"

import { useEffect } from "react"
import { ConsumerStatePage } from "@/components/consumer-state-page"
import { useLanguage } from "@/context/language-context"

export default function RestaurantsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { getTranslation } = useLanguage()

  useEffect(() => {
    console.error("Restaurants management page failed:", error)
  }, [error])

  return (
    <ConsumerStatePage
      variant="error"
      onRetry={reset}
      title={getTranslation("manage.common.restaurantsLoadError")}
      description={getTranslation("manage.common.restaurantAccessRequired")}
      secondaryHref="/manage"
      secondaryLabel={getTranslation("manage.common.returnToDashboard")}
    />
  )
}
