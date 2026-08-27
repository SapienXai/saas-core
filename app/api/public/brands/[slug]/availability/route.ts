import { NextResponse } from "next/server"

import { refreshAvailability } from "@/lib/ai/availability-service"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import {
  fetchPublicBrandBySlug,
  normalizeAvailabilityDate,
  normalizeAvailabilityTime,
  normalizePartySize,
  lastAvailabilitySlots,
  orderAvailabilitySlots,
} from "@/lib/services/public/brand-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const url = new URL(request.url)
  const date = normalizeAvailabilityDate(url.searchParams.get("date"))
  const partySize = normalizePartySize(url.searchParams.get("guests") || url.searchParams.get("party_size"))
  const preferredTime = normalizeAvailabilityTime(url.searchParams.get("time"))

  if (!date || !partySize) {
    return NextResponse.json({ error: "Availability parameters are invalid." }, { status: 400 })
  }

  try {
    await enforceAiRateLimit({ policy: "availability", identity: requestIdentity(request) })
    const brand = await fetchPublicBrandBySlug(slug)
    if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 })

    const locations = await Promise.all(brand.locations.map(async (location) => {
      if (!location.reservationEnabled) {
        return { slug: location.slug, status: "unavailable" as const, slots: [], requestedTimeAvailable: false }
      }

      try {
        const availability = await refreshAvailability({ restaurant_id: location.restaurantId, date, party_size: partySize })
        const orderedSlots = orderAvailabilitySlots(availability.slots.map((slot) => slot.display_time), preferredTime)
        return {
          slug: location.slug,
          status: orderedSlots.length === 0 ? "unavailable" as const : preferredTime && !orderedSlots.includes(preferredTime) ? "nearby" as const : "available" as const,
          slots: lastAvailabilitySlots(orderedSlots),
          requestedTimeAvailable: preferredTime ? orderedSlots.includes(preferredTime) : false,
        }
      } catch (error) {
        console.error("Could not load one public brand location availability:", { slug: location.slug, error })
        return { slug: location.slug, status: "error" as const, slots: [], requestedTimeAvailable: false }
      }
    }))

    return NextResponse.json({ slug: brand.slug, date, partySize, preferredTime, locations }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    console.error("Could not load public brand availability:", error)
    return NextResponse.json({ error: "Availability could not be loaded." }, { status: 503 })
  }
}
