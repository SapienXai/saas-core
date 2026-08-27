import { Suspense } from "react"
import { redirect } from "next/navigation"
import { ReservationApp } from "@/components/reservation-app"
import { OrbLoader } from "@/components/ui/orb-loader"
import { resolvePublicRestaurantRequest } from "@/lib/domains/public-resolver"
import { getHostedRestaurantUrl } from "@/lib/domains/public-url"
import { ConsumerStatePage } from "@/components/consumer-state-page"
import { getServerLanguage } from "@/lib/server-i18n"
import { LanguageProvider } from "@/context/language-context"
import { safeInternalRedirect } from "@/lib/account-state"

export default async function ReservePage({
  searchParams,
}: {
  searchParams: Promise<{ restaurant?: string; restaurantSlug?: string; date?: string; time?: string; guests?: string; lang?: string; from?: string }>
}) {
  const params = await searchParams
  const publicRequest = await resolvePublicRestaurantRequest()
  const tenantRequest = !publicRequest.brand && (publicRequest.kind === "HOSTED_RESTAURANT" || publicRequest.kind === "CUSTOM_RESTAURANT")
  if (tenantRequest && !publicRequest.restaurant) {
    return <ConsumerStatePage variant={publicRequest.kind === "CUSTOM_RESTAURANT" ? "maintenance" : "unavailable"} />
  }
  if (tenantRequest && publicRequest.state === "suspended" && publicRequest.restaurant) {
    redirect(getHostedRestaurantUrl(publicRequest.restaurant.slug))
  }

  // Tenant host identity always wins over query parameters. Root-domain and
  // legacy links retain the existing slug/name compatibility behavior.
  const restaurant = tenantRequest
    ? publicRequest.restaurant!.name
    : params.restaurant || params.restaurantSlug || "Felix Garden"
  const lang = await getServerLanguage(params.lang)
  const initialPartySize = params.guests && /^\d+$/.test(params.guests) ? Number(params.guests) : undefined
  const backHref = safeInternalRedirect(params.from, "") || undefined

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-8" style={{ minHeight: '40vh' }}>
          <OrbLoader label="Loading reservation form..." state="searching" />
        </div>
      }
    >
      <LanguageProvider initialLanguage={lang}>
        <ReservationApp
          initialRestaurant={restaurant}
          initialRestaurantSlug={tenantRequest ? publicRequest.restaurant!.slug : params.restaurantSlug}
          initialDate={params.date}
          initialTime={params.time}
          initialPartySize={initialPartySize}
          backHref={backHref}
        />
      </LanguageProvider>
    </Suspense>
  )
}
