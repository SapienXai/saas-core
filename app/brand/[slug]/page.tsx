import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { BrandStructuredData } from "@/components/brand-structured-data"
import { PublicBrandBookingPage } from "@/components/public-brand-booking-page"
import { LanguageProvider } from "@/context/language-context"
import { getHostedBrandUrl } from "@/lib/domains/public-url"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"
import { fetchPublicBrandBySlug, toPublicBrandView } from "@/lib/services/public/brand-service"

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ lang?: string }> }

export const dynamic = "force-dynamic"

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params
  const query = await searchParams
  const language = await getServerLanguage(query?.lang)
  const brand = await fetchPublicBrandBySlug(slug)
  if (!brand) return { title: translateServer(language, "public.restaurantUnavailableMeta"), robots: { index: false, follow: false } }
  const canonical = getHostedBrandUrl(brand.slug)
  const title = `${brand.name} reservations | Reservevia`
  const description = `${brand.description}. Find a table at ${brand.name}.`
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: "Reservevia", type: "website", images: brand.logoUrl ? [{ url: brand.logoUrl, alt: `${brand.name} logo` }] : undefined },
    twitter: { card: "summary", title, description },
    robots: { index: true, follow: true },
  }
}

export default async function BrandRoute({ params, searchParams }: Props) {
  const { slug } = await params
  const query = await searchParams
  const language = await getServerLanguage(query?.lang)
  const internalBrand = await fetchPublicBrandBySlug(slug)
  if (!internalBrand) notFound()
  const brand = toPublicBrandView(internalBrand)
  const canonical = getHostedBrandUrl(brand.slug)
  return (
    <LanguageProvider initialLanguage={language}>
      <BrandStructuredData brand={brand} canonicalUrl={canonical} />
      <PublicBrandBookingPage brand={brand} />
    </LanguageProvider>
  )
}
