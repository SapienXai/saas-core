import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { MarketingHome } from "@/components/marketing/marketing-home"
import { loadMarketingPlans } from "@/lib/marketing/public-plans"
import { loadPublicBillingPrices } from "@/lib/marketing/public-billing-prices"
import { resolvePublicRestaurantRequest } from "@/lib/domains/public-resolver"
import { getPlatformUrl } from "@/lib/platform-urls"
import { getHostedRestaurantUrl, getRestaurantPublicUrl } from "@/lib/domains/public-url"
import { getHostedBrandUrl } from "@/lib/domains/public-url"
import { BrandStructuredData } from "@/components/brand-structured-data"
import { PublicBrandBookingPage } from "@/components/public-brand-booking-page"
import { RestaurantLandingPage } from "@/components/restaurant-landing-page"
import { RestaurantStructuredData } from "@/components/restaurant-structured-data"
import { LanguageProvider } from "@/context/language-context"
import { redirect } from "next/navigation"
import type { MarketingPlan } from "@/lib/marketing/plan-catalog"
import { RESERVEVIA_OG_HERO } from "@/lib/brand-assets"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"
import { buildRestaurantMetadata, getRestaurantTitle } from "@/lib/restaurant-seo"

export const dynamic = "force-dynamic"

type HomePageProps = {
  searchParams?: Promise<{ lang?: string; manageToken?: string }>
}

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const query = await searchParams
  const language = await getServerLanguage(query?.lang)
  const publicRequest = await resolvePublicRestaurantRequest()
  if (publicRequest.brand) {
    if (publicRequest.state === "suspended") {
      return { title: `${publicRequest.brand.name} reservations | Reservevia`, alternates: { canonical: getHostedBrandUrl(publicRequest.brand.slug) }, robots: { index: false, follow: false } }
    }
    const canonical = publicRequest.hostname ? `https://${publicRequest.hostname}` : getHostedBrandUrl(publicRequest.brand.slug)
    const title = `${publicRequest.brand.name} reservations | Reservevia`
    const description = `${publicRequest.brand.description}. Find a table at ${publicRequest.brand.name}.`
    return { title, description, alternates: { canonical }, openGraph: { title, description, url: canonical, siteName: "Reservevia", type: "website" }, robots: { index: true, follow: true } }
  }
  if ((publicRequest.kind === "HOSTED_RESTAURANT" || publicRequest.kind === "CUSTOM_RESTAURANT") && publicRequest.restaurant) {
    const restaurant = publicRequest.restaurant
    if (publicRequest.state === "suspended") {
      return {
        title: getRestaurantTitle(restaurant.name),
        alternates: { canonical: getHostedRestaurantUrl(restaurant.slug) },
        robots: { index: false, follow: false },
      }
    }
    const canonical = await getRestaurantPublicUrl({ id: publicRequest.restaurantId, slug: restaurant.slug, workspaceId: publicRequest.workspaceId })
    return buildRestaurantMetadata({
      restaurant,
      canonical,
      fallbackDescription: translateServer(language, "public.reserveAtDescription", { restaurant: restaurant.name }),
      language,
    })
  }

  if (publicRequest.kind === "HOSTED_RESTAURANT" || publicRequest.kind === "CUSTOM_RESTAURANT") {
    return {
      title: translateServer(language, "public.restaurantUnavailableMeta"),
      robots: { index: false, follow: false },
    }
  }

  return {
    title: translateServer(language, "marketing.metaTitle"),
    description: translateServer(language, "marketing.metaDescription"),
    keywords: translateServer(language, "marketing.metaKeywords"),
    alternates: { canonical: getPlatformUrl("/") },
    openGraph: {
      title: translateServer(language, "marketing.metaTitle"),
      description: translateServer(language, "marketing.metaOgDescription"),
      url: getPlatformUrl("/"),
      siteName: "Reservevia",
      type: "website",
      images: [{ url: RESERVEVIA_OG_HERO, width: 1200, height: 630, alt: translateServer(language, "marketing.metaImageAlt") }],
    },
    twitter: {
      card: "summary_large_image",
      title: translateServer(language, "marketing.metaTitle"),
      description: translateServer(language, "marketing.metaOgDescription"),
      images: [RESERVEVIA_OG_HERO],
    },
  }
}

export default async function Home({ searchParams }: HomePageProps) {
  const query = await searchParams
  const language = await getServerLanguage(query?.lang)
  const publicRequest = await resolvePublicRestaurantRequest()
  if (publicRequest.brand) {
    if (publicRequest.state === "suspended") redirect(getHostedBrandUrl(publicRequest.brand.slug))
    const canonical = publicRequest.hostname ? `https://${publicRequest.hostname}` : getHostedBrandUrl(publicRequest.brand.slug)
    return <><LanguageProvider initialLanguage={language}><BrandStructuredData brand={publicRequest.brand} canonicalUrl={canonical} /><PublicBrandBookingPage brand={publicRequest.brand} /></LanguageProvider></>
  }
  if (publicRequest.kind === "HOSTED_RESTAURANT" || publicRequest.kind === "CUSTOM_RESTAURANT") {
    if (!publicRequest.restaurant) notFound()
    if (publicRequest.state === "suspended") redirect(getHostedRestaurantUrl(publicRequest.restaurant.slug))
    const canonical = await getRestaurantPublicUrl({
      id: publicRequest.restaurantId,
      slug: publicRequest.restaurant.slug,
      workspaceId: publicRequest.workspaceId,
    })
    return (
      <>
        <LanguageProvider initialLanguage={language}>
          <RestaurantStructuredData restaurant={publicRequest.restaurant} canonicalUrl={canonical} />
          <RestaurantLandingPage restaurant={publicRequest.restaurant} reservationToken={query?.manageToken} />
        </LanguageProvider>
      </>
    )
  }

  if (publicRequest.kind === "UNKNOWN" || publicRequest.kind === "PLATFORM_APP") notFound()

  let plans: MarketingPlan[] = []
  try {
    plans = await loadMarketingPlans()
  } catch (error) {
    console.error("Marketing plan catalog could not be loaded:", error)
  }
  const billingPrices = await loadPublicBillingPrices()

  return (
    <LanguageProvider initialLanguage={language}>
      <MarketingHome plans={plans} billingPrices={billingPrices} />
    </LanguageProvider>
  )
}
