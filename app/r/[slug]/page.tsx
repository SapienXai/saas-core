import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"
import { RestaurantLandingPage } from "@/components/restaurant-landing-page"
import { RestaurantStructuredData } from "@/components/restaurant-structured-data"
import { BrandStructuredData } from "@/components/brand-structured-data"
import { PublicBrandBookingPage } from "@/components/public-brand-booking-page"
import { LanguageProvider } from "@/context/language-context"
import { fetchPublicRestaurantProfileBySlug } from "@/lib/services/public/restaurant-service"
import { resolvePublicRestaurantRequest } from "@/lib/domains/public-resolver"
import { getHostedRestaurantUrl, getRestaurantPublicUrl } from "@/lib/domains/public-url"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"
import { buildRestaurantMetadata, getRestaurantTitle } from "@/lib/restaurant-seo"
import { safeInternalRedirect } from "@/lib/account-state"

type RestaurantRouteProps = {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ lang?: string; manageToken?: string; from?: string }>
}

const getRestaurantProfile = cache(async (slug: string) => {
  return fetchPublicRestaurantProfileBySlug(slug)
})

export async function generateMetadata({ params, searchParams }: RestaurantRouteProps): Promise<Metadata> {
  const { slug } = await params
  const query = await searchParams
  const language = await getServerLanguage(query?.lang)
  const publicRequest = await resolvePublicRestaurantRequest()
  if (publicRequest.brand) {
    if (publicRequest.state === "suspended") return { title: `${publicRequest.brand.name} reservations | Reservevia`, alternates: { canonical: `/brand/${publicRequest.brand.slug}` }, robots: { index: false, follow: false } }
    const canonical = publicRequest.hostname ? `https://${publicRequest.hostname}` : `/brand/${publicRequest.brand.slug}`
    const title = `${publicRequest.brand.name} reservations | Reservevia`
    return { title, description: publicRequest.brand.description, alternates: { canonical }, robots: { index: true, follow: true } }
  }
  const tenantRequest = publicRequest.kind === "HOSTED_RESTAURANT" || publicRequest.kind === "CUSTOM_RESTAURANT"
  if (tenantRequest && publicRequest.restaurantSlug !== slug) {
    return {
      title: translateServer(language, "public.restaurantUnavailableMeta"),
      robots: { index: false, follow: false },
    }
  }
  if (tenantRequest && publicRequest.state === "suspended" && publicRequest.restaurant) {
    return {
      title: getRestaurantTitle(publicRequest.restaurant.name),
      alternates: { canonical: getHostedRestaurantUrl(publicRequest.restaurant.slug) },
      robots: { index: false, follow: false },
    }
  }
  const restaurant = await getRestaurantProfile(slug)
  if (!restaurant) {
    return {
      title: translateServer(language, "public.restaurantUnavailableMeta"),
      robots: { index: false, follow: false },
    }
  }

  const canonical = await getRestaurantPublicUrl({
    slug: restaurant.slug,
    id: publicRequest.restaurantId,
    workspaceId: publicRequest.workspaceId,
  })

  return buildRestaurantMetadata({
    restaurant,
    canonical,
    fallbackDescription: translateServer(language, "public.reserveAtDescription", { restaurant: restaurant.name }),
    language,
  })
}

export default async function RestaurantRoute({ params, searchParams }: RestaurantRouteProps) {
  const { slug } = await params
  const query = await searchParams
  const language = await getServerLanguage(query?.lang)
  const backHref = safeInternalRedirect(query?.from, "") || undefined
  const publicRequest = await resolvePublicRestaurantRequest()
  if (publicRequest.brand) {
    if (publicRequest.state === "suspended") redirect(`/brand/${publicRequest.brand.slug}`)
    const canonical = publicRequest.hostname ? `https://${publicRequest.hostname}` : `/brand/${publicRequest.brand.slug}`
    return <><LanguageProvider initialLanguage={language}><BrandStructuredData brand={publicRequest.brand} canonicalUrl={canonical} /><PublicBrandBookingPage brand={publicRequest.brand} /></LanguageProvider></>
  }
  const tenantRequest = publicRequest.kind === "HOSTED_RESTAURANT" || publicRequest.kind === "CUSTOM_RESTAURANT"
  if (tenantRequest) {
    if (!publicRequest.restaurant || publicRequest.restaurantSlug !== slug) notFound()
    if (publicRequest.state === "suspended") redirect(getHostedRestaurantUrl(publicRequest.restaurant.slug))
    const canonical = await getRestaurantPublicUrl({
      slug: publicRequest.restaurant.slug,
      id: publicRequest.restaurantId,
      workspaceId: publicRequest.workspaceId,
    })
    return (
      <>
        <LanguageProvider initialLanguage={language}>
          <RestaurantStructuredData restaurant={publicRequest.restaurant} canonicalUrl={canonical} />
          <RestaurantLandingPage restaurant={publicRequest.restaurant} reservationToken={query?.manageToken} backHref={backHref} />
        </LanguageProvider>
      </>
    )
  }
  const restaurant = await getRestaurantProfile(slug)
  if (!restaurant) notFound()

  const canonical = await getRestaurantPublicUrl({ slug: restaurant.slug, id: restaurant.restaurantId })

  return (
    <>
      <LanguageProvider initialLanguage={language}>
        <RestaurantStructuredData restaurant={restaurant} canonicalUrl={canonical} />
        <RestaurantLandingPage restaurant={restaurant} reservationToken={query?.manageToken} backHref={backHref} />
      </LanguageProvider>
    </>
  )
}
