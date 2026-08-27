import { createReserveviaOgImage, createRestaurantOgImage } from "@/lib/restaurant-og-image"
import { resolvePublicRestaurantRequest } from "@/lib/domains/public-resolver"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const publicRequest = await resolvePublicRestaurantRequest()
  if (!publicRequest.restaurant || publicRequest.state !== "resolved") return createReserveviaOgImage()

  return createRestaurantOgImage(publicRequest.restaurant)
}
