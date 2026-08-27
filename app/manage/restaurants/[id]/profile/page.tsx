import { notFound, redirect } from "next/navigation"
import { RestaurantProfileForm } from "@/components/restaurant-profile-form"
import { AuthorizationError, requireRestaurantManagementAccess } from "@/lib/authorization"
import { createServiceRoleClient } from "@/lib/supabase"
import { getConfiguredRootDomain } from "@/lib/domains/hostname"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"

export default async function RestaurantProfileRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    await requireRestaurantManagementAccess(id)
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === "UNAUTHENTICATED") redirect("/login?redirect=/manage")
    notFound()
  }

  const { data: restaurant, error } = await createServiceRoleClient()
    .from("restaurants")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error || !restaurant) notFound()
  return <RestaurantProfileForm
    restaurant={{
      ...restaurant,
      logo_url: getSafeRestaurantAssetUrl(restaurant.logo_url),
      primary_image_url: getSafeRestaurantAssetUrl(restaurant.primary_image_url),
    }}
    rootDomain={getConfiguredRootDomain()}
  />
}
