import { fetchPublicRestaurantDiscoveryBatch } from "@/lib/services/manage/restaurant-service"
import { parseRestaurantDiscoveryQuery } from "@/lib/restaurant-discovery"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const query = parseRestaurantDiscoveryQuery({
      q: url.searchParams.get("q") || undefined,
      location: url.searchParams.get("location") || undefined,
      cuisine: url.searchParams.get("cuisine") || undefined,
      atmosphere: url.searchParams.get("atmosphere") || undefined,
    })
    const result = await fetchPublicRestaurantDiscoveryBatch(query, url.searchParams.get("cursor"))

    return Response.json({
      restaurants: result.restaurants,
      total: result.total,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    }, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
      },
    })
  } catch (error) {
    console.error("Could not load the next public restaurant discovery batch:", error)
    return Response.json({ error: "Could not load restaurants." }, { status: 500 })
  }
}
