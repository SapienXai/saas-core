import { notFound, redirect } from "next/navigation"
import { RestaurantLandingPage } from "@/components/restaurant-landing-page"
import { requireRestaurantManagementAccess } from "@/lib/authorization"
import { createServiceRoleClient } from "@/lib/supabase"
import { toPublicRestaurantProfile } from "@/lib/restaurant-profile"

export const dynamic = "force-dynamic"

type PreviewPageProps = {
  searchParams: Promise<{ restaurantId?: string }>
}

export default async function OnboardingPreviewPage({ searchParams }: PreviewPageProps) {
  const { restaurantId } = await searchParams
  if (!restaurantId) redirect("/onboarding")

  try {
    await requireRestaurantManagementAccess(restaurantId, ["owner"])
  } catch {
    notFound()
  }

  const { data: restaurant } = await createServiceRoleClient()
    .from("restaurants")
    .select("name, slug, logo_url, primary_image_url, description, cuisine, atmosphere, hours, phone, whatsapp, menu_url, location_url, events_url, social_links, profile_visibility, location, timezone, language, status, reservation_enabled, reservation_start_date")
    .eq("id", restaurantId)
    .maybeSingle()

  if (!restaurant) notFound()

  return <RestaurantLandingPage restaurant={toPublicRestaurantProfile(restaurant, { showReserveviaBranding: true })} preview />
}
