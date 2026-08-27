import "server-only"

import { validateReservationAvailability } from "@/lib/reservation-validation"
import { ApiDomainError, type ReservationModifyInput } from "@/lib/ai/contracts"
import { resolveCustomerManagementToken } from "@/lib/ai/management"
import { sendReservationPushNotification } from "@/lib/push-service"
import { buildReservationUpdateSummary } from "@/lib/reservation-update-summary"
import { createServiceRoleClient } from "@/lib/supabase"

export async function getReservationConfirmation(reservationId: string, token: string) {
  const reservation = await resolveCustomerManagementToken(token, reservationId)
  return {
    reservation_id: reservation.id,
    restaurant_id: reservation.restaurant_id,
    restaurant_name: reservation.restaurant?.name || "",
    restaurant_slug: reservation.restaurant?.slug || null,
    status: reservation.status,
    date: reservation.reservation_date,
    time: String(reservation.reservation_time).slice(0, 5),
    party_size: reservation.party_size,
    guest: {
      name: reservation.customer_name,
      phone: reservation.customer_phone,
      email: reservation.customer_email,
    },
  }
}

export async function modifyReservation(input: ReservationModifyInput, token: string) {
  const reservation = await resolveCustomerManagementToken(token, input.reservation_id)
  if (reservation.status === "cancelled") throw new ApiDomainError("RESERVATION_ALREADY_CANCELLED", "This reservation has already been cancelled.", false, "create_new_reservation", 409)
  const date = input.date || reservation.reservation_date
  const time = input.time || String(reservation.reservation_time).slice(0, 5)
  const partySize = input.party_size || reservation.party_size
  const supabase = createServiceRoleClient() as any
  const restaurant = await supabase.from("restaurants").select("reservation_enabled, opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, allowed_days_of_week, blocked_dates, reservation_start_date, reservation_blocked_intervals").eq("id", reservation.restaurant_id).maybeSingle()
  const area = reservation.reservation_area_id
    ? await supabase.from("reservation_areas").select("opening_time, closing_time, time_slot_duration, max_party_size, min_party_size, advance_booking_days, min_advance_hours, allowed_days_of_week, blocked_dates").eq("id", reservation.reservation_area_id).maybeSingle()
    : { data: null }
  if (restaurant.error || !restaurant.data) throw new ApiDomainError("RESTAURANT_NOT_FOUND", "The restaurant could not be found.", false, "check_reservation", 404)
  const validation = validateReservationAvailability({ reservation_date: date, reservation_time: time, party_size: partySize }, restaurant.data, area.data)
  if (validation) throw new ApiDomainError("INVALID_REQUEST", validation, false, "choose_different_time", 400)
  const guest = input.guest || {}
  const updated = await supabase.from("reservations").update({
    reservation_date: date,
    reservation_time: time,
    party_size: partySize,
    customer_name: guest.name || reservation.customer_name,
    customer_phone: guest.phone || reservation.customer_phone,
    customer_email: guest.email || reservation.customer_email,
    special_requests: guest.notes || reservation.special_requests,
    status: "pending",
  }).eq("id", input.reservation_id).in("status", ["pending", "confirmed"]).select("id, reservation_date, reservation_time, party_size, status").maybeSingle()
  if (updated.error || !updated.data) throw new ApiDomainError("RESERVATION_CONFLICT", "The reservation could not be modified.", true, "retry_request", 409)

  const updateSummary = buildReservationUpdateSummary({ ...reservation }, {
    ...reservation,
    reservation_date: date,
    reservation_time: time,
    party_size: partySize,
    customer_name: guest.name || reservation.customer_name,
    customer_phone: guest.phone || reservation.customer_phone,
    customer_email: guest.email || reservation.customer_email,
    special_requests: guest.notes || reservation.special_requests,
    status: "pending",
  }, { source: "customer" })
  if (updateSummary) {
    const { error: summaryError } = await supabase.from("reservations").update({
      last_update_summary: updateSummary,
      last_updated_by_user_id: null,
    }).eq("id", input.reservation_id)
    if (summaryError) console.error("Failed to save API reservation update summary:", summaryError)
  }
  await sendReservationPushNotification(input.reservation_id, "updated").catch((error) => {
    console.error("Failed to send API reservation update push notification:", error)
  })
  return { reservation_id: updated.data.id, status: updated.data.status, date: updated.data.reservation_date, time: String(updated.data.reservation_time).slice(0, 5), party_size: updated.data.party_size }
}

export async function cancelReservation(reservationId: string, token: string) {
  const reservation = await resolveCustomerManagementToken(token, reservationId)
  if (reservation.status === "cancelled") throw new ApiDomainError("RESERVATION_ALREADY_CANCELLED", "This reservation has already been cancelled.", false, "no_action_needed", 409)
  const supabase = createServiceRoleClient() as any
  const updated = await supabase.from("reservations").update({ status: "cancelled" }).eq("id", reservationId).in("status", ["pending", "confirmed"]).select("id, status").maybeSingle()
  if (updated.error || !updated.data) throw new ApiDomainError("RESERVATION_CONFLICT", "The reservation could not be cancelled.", true, "retry_request", 409)

  const updateSummary = buildReservationUpdateSummary({ ...reservation }, { ...reservation, status: "cancelled" }, { source: "customer" })
  if (updateSummary) {
    const { error: summaryError } = await supabase.from("reservations").update({
      last_update_summary: updateSummary,
      last_updated_by_user_id: null,
    }).eq("id", reservationId)
    if (summaryError) console.error("Failed to save API reservation cancellation summary:", summaryError)
  }
  await sendReservationPushNotification(reservationId, "cancelled").catch((error) => {
    console.error("Failed to send API reservation cancellation push notification:", error)
  })
  return { reservation_id: updated.data.id, status: "cancelled" as const }
}
