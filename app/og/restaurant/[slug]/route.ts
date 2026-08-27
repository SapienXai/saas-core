import { fetchPublicRestaurantProfileBySlug } from "@/lib/services/public/restaurant-service"
import { createRestaurantOgImage } from "@/lib/restaurant-og-image"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const restaurant = await fetchPublicRestaurantProfileBySlug(slug)
  if (!restaurant) return new Response("Not found", { status: 404 })

  return createRestaurantOgImage(restaurant)
}
