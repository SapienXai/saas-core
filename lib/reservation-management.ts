import "server-only"

import { revalidatePath } from "next/cache"
import { createServiceRoleClient } from "@/lib/supabase"
import { hashReservationManageToken, isReservationManageToken } from "@/lib/claimable-restaurants"
import { sendEmail } from "@/lib/email-service"
import { generateStatusUpdateEmail } from "@/lib/reservation-email-templates"
import { formatDate as formatLocalizedDate } from "@/i18n/format"
import { resolveLanguage } from "@/i18n/config"
import { buildCustomerReservationManageUrl } from "@/lib/customer-reservation-links"
import { issueCustomerManagementToken } from "@/lib/ai/management"
import { getRestaurantPublicUrl } from "@/lib/domains/public-url"

export type BusinessReservationView = {
  tokenId: string
  reservationId: string
  restaurantId: string
  restaurantName: string
  restaurantSlug: string
  reservationAreaName: string | null
  customerName: string
  reservationDate: string
  reservationTime: string
  partySize: number
  specialRequests: string | null
  reservationType: string | null
  status: string
  expiresAt: string
}

export async function resolveReservationManagementToken(rawToken: string): Promise<BusinessReservationView | null> {
  if (!isReservationManageToken(rawToken)) return null
  const service = createServiceRoleClient()
  const { data: token, error: tokenError } = await service
    .from("reservation_management_tokens")
    .select("id, reservation_id, restaurant_id, expires_at, revoked_at")
    .eq("token_hash", hashReservationManageToken(rawToken))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (tokenError || !token) return null
  const { data: reservation, error } = await service
    .from("reservations")
    .select("id, restaurant_id, customer_name, reservation_date, reservation_time, party_size, special_requests, reservation_type, status, restaurants(name, slug), reservation_areas(name)")
    .eq("id", token.reservation_id)
    .eq("restaurant_id", token.restaurant_id)
    .maybeSingle()
  if (error || !reservation) return null
  const restaurant = Array.isArray(reservation.restaurants) ? reservation.restaurants[0] : reservation.restaurants
  const area = Array.isArray(reservation.reservation_areas) ? reservation.reservation_areas[0] : reservation.reservation_areas
  if (!restaurant?.name || !restaurant.slug) return null
  return {
    tokenId: token.id,
    reservationId: reservation.id,
    restaurantId: reservation.restaurant_id,
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug,
    reservationAreaName: area?.name || null,
    customerName: reservation.customer_name,
    reservationDate: reservation.reservation_date,
    reservationTime: reservation.reservation_time,
    partySize: reservation.party_size,
    specialRequests: reservation.special_requests,
    reservationType: reservation.reservation_type,
    status: reservation.status || "pending",
    expiresAt: token.expires_at,
  }
}

export async function respondToReservationViaToken(rawToken: string, decision: "confirmed" | "cancelled", lang = "en") {
  if (decision !== "confirmed" && decision !== "cancelled") return { success: false as const, message: "This reservation decision is invalid." }
  const view = await resolveReservationManagementToken(rawToken)
  if (!view) return { success: false as const, message: "This reservation link is invalid or has expired." }
  if (view.status === decision) return { success: true as const, status: view.status, idempotent: true as const }
  if (view.status !== "pending") return { success: false as const, message: "This reservation has already been resolved." }

  const service = createServiceRoleClient()
  const { data: updated, error } = await service
    .from("reservations")
    .update({ status: decision })
    .eq("id", view.reservationId)
    .eq("status", "pending")
    .select("id, status")
    .maybeSingle()
  if (error) return { success: false as const, message: "The reservation could not be updated." }
  if (!updated) {
    const latest = await resolveReservationManagementToken(rawToken)
    if (latest?.status === decision) return { success: true as const, status: decision, idempotent: true as const }
    return { success: false as const, message: "This reservation was resolved by another action." }
  }

  await service.from("reservation_management_tokens").update({ consumed_at: new Date().toISOString() }).eq("id", view.tokenId).is("consumed_at", null)
  const language = resolveLanguage(lang)
  const formattedDate = formatLocalizedDate(new Date(view.reservationDate), language, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
  const { data: reservationDetails } = await service.from("reservations").select("customer_email, customer_name, reservation_type, reservation_areas(name), restaurants(name, slug, language)").eq("id", view.reservationId).maybeSingle()
  const restaurant = Array.isArray(reservationDetails?.restaurants) ? reservationDetails?.restaurants[0] : reservationDetails?.restaurants
  if (reservationDetails?.customer_email) {
    let manageUrl: string | undefined
    if (restaurant?.slug) {
      try {
        const access = await issueCustomerManagementToken({
          reservationId: view.reservationId,
          restaurantId: view.restaurantId,
          ttlHours: 168,
        })
        const publicUrl = await getRestaurantPublicUrl({
          id: view.restaurantId,
          slug: restaurant.slug,
        })
        manageUrl = buildCustomerReservationManageUrl(publicUrl, access.token, restaurant?.language || language)
      } catch (error) {
        console.error("Could not create customer reservation management link for token email:", error)
      }
    }

    const email = generateStatusUpdateEmail({
      customerName: reservationDetails.customer_name,
      restaurantName: restaurant?.name || view.restaurantName,
      reservationAreaName: (Array.isArray(reservationDetails.reservation_areas) ? reservationDetails.reservation_areas[0] : reservationDetails.reservation_areas)?.name || view.reservationAreaName,
      reservationDate: formattedDate,
      reservationTime: view.reservationTime,
      partySize: view.partySize,
      status: decision === "confirmed" ? "confirmed" : "cancelled",
      reservationType: reservationDetails.reservation_type || view.reservationType || undefined,
      manageUrl: decision === "confirmed" ? manageUrl : undefined,
      lang: restaurant?.language || language,
    })
    const result = await sendEmail({ to: reservationDetails.customer_email, subject: email.subject, html: email.html, text: email.text })
    if (!result.success) console.error("Guest outcome email failed:", result.error)
  }
  try {
    revalidatePath("/reservation/manage/[token]", "page")
    revalidatePath("/manage/reservations")
  } catch (revalidationError) {
    // A direct worker/test invocation has no Next.js static-generation store;
    // the durable reservation update and email outcome have already succeeded.
    console.warn("Reservation management revalidation was unavailable:", revalidationError)
  }
  return { success: true as const, status: decision, idempotent: false as const }
}
