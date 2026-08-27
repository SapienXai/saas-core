import "server-only"

import { createHmac } from "node:crypto"
import { validateReservationAvailability } from "@/lib/reservation-validation"
import { ApiDomainError, type AvailabilityInput, type HoldInput, type ReservationCreateInput } from "@/lib/ai/contracts"
import { getPublicRestaurantById } from "@/lib/ai/restaurant-directory"
import { getRestaurantReservationQuotaState } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"

type Area = {
  id: string
  name: string
  is_active: boolean
  opening_time: string | null
  closing_time: string | null
  time_slot_duration: number | null
  max_party_size: number | null
  min_party_size: number | null
  advance_booking_days: number | null
  min_advance_hours: number | null
  allowed_days_of_week: number[] | null
  blocked_dates: string[] | null
  max_concurrent_reservations: number | null
}

function slotSecret() {
  return process.env.RESERVEVIA_SLOT_SECRET || process.env.RESERVEVIA_RATE_LIMIT_SECRET || (process.env.NODE_ENV === "production" ? null : "reservevia-local-slot-secret")
}

function slotId(restaurantId: string, areaId: string | null, date: string, time: string) {
  const secret = slotSecret()
  if (!secret) throw new ApiDomainError("INTERNAL_ERROR", "Availability signing is not configured.", false, "contact_support", 503)
  const value = `${restaurantId}|${areaId || "default"}|${date}|${time}`
  const signature = createHmac("sha256", secret).update(value).digest("base64url").slice(0, 22)
  return `slot_${Buffer.from(value).toString("base64url")}_${signature}`
}

function parseMinutes(value: string | null | undefined) {
  if (!value) return null
  const [hour, minute] = value.slice(0, 5).split(":").map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

function timeText(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

function localDateTimeToIso(date: string, time: string, timezone: string) {
  const naive = new Date(`${date}T${time}:00.000Z`)
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(naive)
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00"
    const renderedAsUtc = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`)
    const intendedAsUtc = Date.parse(`${date}T${time}:00Z`)
    return new Date(naive.getTime() + intendedAsUtc - renderedAsUtc).toISOString()
  } catch {
    return naive.toISOString()
  }
}

async function loadBookingContext(restaurantId: string, areaId?: string) {
  const restaurant = await getPublicRestaurantById(restaurantId)
  if (!restaurant) throw new ApiDomainError("RESTAURANT_NOT_FOUND", "The published restaurant could not be found.", false, "search_restaurants", 404)
  if (restaurant.reservation_enabled !== true) throw new ApiDomainError("RESTAURANT_NOT_BOOKABLE", "This restaurant is not accepting reservations.", false, "choose_another_restaurant", 409)
  const quota = await getRestaurantReservationQuotaState(restaurantId)
  if (quota && !quota.available) throw new ApiDomainError("RESTAURANT_NOT_BOOKABLE", "This restaurant is not accepting reservations.", false, "choose_another_restaurant", 409)
  const supabase = createServiceRoleClient() as any
  const areaResult = await supabase.from("reservation_areas").select("id, name, is_active, opening_time, closing_time, time_slot_duration, max_party_size, min_party_size, advance_booking_days, min_advance_hours, allowed_days_of_week, blocked_dates, max_concurrent_reservations").eq("restaurant_id", restaurantId).eq("is_active", true).order("display_order", { ascending: true })
  if (areaResult.error) throw new ApiDomainError("INTERNAL_ERROR", "Availability could not be loaded.", true, "retry_request", 503)
  const areas = (areaResult.data || []) as Area[]
  if (areaId && !areas.some((area) => area.id === areaId)) throw new ApiDomainError("RESTAURANT_NOT_BOOKABLE", "The requested reservation area is not available.", false, "refresh_restaurant", 409)
  return { restaurant, areas: areaId ? areas.filter((area) => area.id === areaId) : areas }
}

function contextSettings(restaurant: any, area: Area | null) {
  return {
    reservation_enabled: restaurant.reservation_enabled,
    opening_time: area?.opening_time ?? restaurant.opening_time,
    closing_time: area?.closing_time ?? restaurant.closing_time,
    time_slot_duration: area?.time_slot_duration ?? restaurant.time_slot_duration,
    advance_booking_days: area?.advance_booking_days ?? restaurant.advance_booking_days,
    min_advance_hours: area?.min_advance_hours ?? restaurant.min_advance_hours,
    max_party_size: area?.max_party_size ?? restaurant.max_party_size,
    min_party_size: area?.min_party_size ?? restaurant.min_party_size,
    allowed_days_of_week: area?.allowed_days_of_week ?? restaurant.allowed_days_of_week,
    blocked_dates: area?.blocked_dates ?? restaurant.blocked_dates,
    reservation_start_date: restaurant.reservation_start_date,
    reservation_blocked_intervals: restaurant.reservation_blocked_intervals,
  }
}

function validationError(message: string) {
  if (message.includes("Party size")) return new ApiDomainError("INVALID_PARTY_SIZE", message, false, "choose_different_party_size", 400)
  if (message.includes("valid reservation date") || message.includes("selected date") || message.includes("selected day") || message.includes("booking window") || message.includes("starting from")) return new ApiDomainError("INVALID_DATE", message, false, "choose_different_date", 400)
  if (message.includes("fully booked") || message.includes("time between")) return new ApiDomainError("NO_AVAILABILITY", message, false, "refresh_availability", 409)
  return new ApiDomainError("INVALID_REQUEST", message, false, "correct_request", 400)
}

export type AvailabilitySlot = {
  slot_id: string
  reservation_area_id: string | null
  starts_at: string
  display_time: string
  holdable: boolean
}

export async function refreshAvailability(input: AvailabilityInput) {
  const context = await loadBookingContext(input.restaurant_id, input.reservation_area_id)
  const supabase = createServiceRoleClient() as any
  const reservations = await supabase.from("reservations").select("reservation_area_id, reservation_time, status").eq("restaurant_id", input.restaurant_id).eq("reservation_date", input.date).in("status", ["pending", "confirmed"])
  const holds = await supabase.from("reservation_holds").select("reservation_area_id, reservation_time, status, expires_at").eq("restaurant_id", input.restaurant_id).eq("reservation_date", input.date).eq("status", "active").gt("expires_at", new Date().toISOString())
  if (reservations.error || holds.error) throw new ApiDomainError("INTERNAL_ERROR", "Availability could not be loaded.", true, "retry_request", 503)
  const slots: AvailabilitySlot[] = []
  const areas = context.areas.length > 0 ? context.areas : [null]
  for (const area of areas) {
    const settings = contextSettings(context.restaurant, area)
    const opening = parseMinutes(settings.opening_time)
    const closing = parseMinutes(settings.closing_time)
    const duration = Number(settings.time_slot_duration)
    if (opening === null || closing === null || !Number.isInteger(duration) || duration <= 0) throw new ApiDomainError("INTERNAL_ERROR", "This restaurant's reservation settings are invalid.", false, "contact_support", 500)
    for (let minute = opening; minute <= closing; minute += duration) {
      const time = timeText(minute)
      const error = validateReservationAvailability({ reservation_date: input.date, reservation_time: time, party_size: input.party_size }, settings, area)
      if (error) continue
      const reservationCount = (reservations.data || []).filter((row: any) => row.reservation_area_id === (area?.id || null) && String(row.reservation_time).slice(0, 5) === time).length
      const holdCount = (holds.data || []).filter((row: any) => row.reservation_area_id === (area?.id || null) && String(row.reservation_time).slice(0, 5) === time).length
      const capacityAvailable = area?.max_concurrent_reservations == null || reservationCount + holdCount < area.max_concurrent_reservations
      if (!capacityAvailable) continue
      slots.push({
        slot_id: slotId(input.restaurant_id, area?.id || null, input.date, time),
        reservation_area_id: area?.id || null,
        starts_at: localDateTimeToIso(input.date, time, context.restaurant.timezone || "UTC"),
        display_time: time,
        holdable: Boolean(area?.max_concurrent_reservations),
      })
    }
  }
  return {
    restaurant_id: input.restaurant_id,
    date: input.date,
    party_size: input.party_size,
    timezone: context.restaurant.timezone || "UTC",
    required_guest_fields: Array.isArray((context.restaurant as any).required_guest_fields) ? (context.restaurant as any).required_guest_fields : ["name", "phone"],
    optional_guest_fields: Array.isArray((context.restaurant as any).optional_guest_fields) ? (context.restaurant as any).optional_guest_fields : ["email", "notes"],
    slots,
  }
}

function assertGuestFields(restaurant: any, input: ReservationCreateInput) {
  const required = Array.isArray(restaurant.required_guest_fields) ? restaurant.required_guest_fields : ["name", "phone"]
  const missing = required.filter((field: string) => {
    const value = input.guest[field as keyof typeof input.guest]
    return typeof value !== "string" || !value.trim()
  })
  if (missing.length > 0) throw new ApiDomainError("MISSING_REQUIRED_GUEST_DATA", "More guest information is required to complete this reservation.", false, "collect_guest_data", 422)
}

async function validateCreateInput(input: ReservationCreateInput) {
  const context = await loadBookingContext(input.restaurant_id, input.reservation_area_id)
  assertGuestFields(context.restaurant, input)
  const area = context.areas.find((candidate) => candidate.id === input.reservation_area_id) || null
  const error = validateReservationAvailability({ reservation_date: input.date, reservation_time: input.time, party_size: input.party_size }, contextSettings(context.restaurant, area), area)
  if (error) throw validationError(error)
  return { context, area }
}

function mapRpcError(error: any): never {
  const message = String(error?.message || "")
  if (message.includes("HOLD_EXPIRED")) throw new ApiDomainError("HOLD_EXPIRED", "The selected hold has expired.", true, "refresh_availability", 409)
  if (message.includes("HOLD_NOT_FOUND")) throw new ApiDomainError("HOLD_NOT_FOUND", "The selected hold could not be found.", false, "refresh_availability", 404)
  if (message.includes("HOLD_SLOT_UNAVAILABLE")) throw new ApiDomainError("SLOT_NO_LONGER_AVAILABLE", "The selected time is no longer available.", true, "refresh_availability", 409)
  if (message.includes("HOLD_UNAVAILABLE")) throw new ApiDomainError("HOLD_UNAVAILABLE", "This restaurant has not configured a safe capacity hold for that area.", false, "make_direct_reservation", 409)
  throw new ApiDomainError("RESERVATION_CONFLICT", "The reservation could not be completed.", true, "retry_request", 409)
}

export async function createReservationHold(input: HoldInput, apiClientId: string) {
  const availability = await refreshAvailability(input)
  const slot = input.preferred_time ? availability.slots.find((candidate) => candidate.display_time === input.preferred_time && candidate.holdable) : availability.slots.find((candidate) => candidate.holdable)
  if (!slot) throw new ApiDomainError("HOLD_UNAVAILABLE", "No holdable time is available for this request.", false, "choose_available_time", 409)
  const result = await (createServiceRoleClient() as any).rpc("create_reservation_hold", {
    p_restaurant_id: input.restaurant_id,
    p_reservation_area_id: slot.reservation_area_id,
    p_reservation_date: input.date,
    p_reservation_time: slot.display_time,
    p_party_size: input.party_size,
    p_ttl_seconds: input.ttl_seconds,
    p_api_client_id: apiClientId,
  })
  if (result.error) mapRpcError(result.error)
  const row = result.data?.[0]
  if (!row) throw new ApiDomainError("HOLD_UNAVAILABLE", "The selected time could not be held.", true, "refresh_availability", 409)
  return { hold_id: row.hold_id, restaurant_id: input.restaurant_id, slot_id: slot.slot_id, expires_at: row.expires_at }
}

export async function makeReservation(input: ReservationCreateInput, apiClientId: string) {
  const { context, area } = await validateCreateInput(input)
  const supabase = createServiceRoleClient() as any
  let reservationId: string | null = null
  if (input.hold_id) {
    const result = await supabase.rpc("convert_reservation_hold", {
      p_hold_id: input.hold_id,
      p_api_client_id: apiClientId,
      p_customer_name: input.guest.name,
      p_customer_phone: input.guest.phone,
      p_customer_email: input.guest.email || null,
      p_special_requests: [input.guest.notes, input.guest.dietary_requirements].filter(Boolean).join("\n") || null,
      p_reservation_type: input.reservation_type,
      p_source_channel: input.source_channel,
    })
    if (result.error) mapRpcError(result.error)
    reservationId = result.data?.[0]?.reservation_id || null
  } else {
    const inserted = await supabase.from("reservations").insert({
      restaurant_id: input.restaurant_id,
      reservation_area_id: area?.id || null,
      customer_name: input.guest.name,
      customer_phone: input.guest.phone,
      customer_email: input.guest.email || null,
      party_size: input.party_size,
      reservation_date: input.date,
      reservation_time: input.time,
      special_requests: [input.guest.notes, input.guest.dietary_requirements].filter(Boolean).join("\n") || null,
      reservation_type: input.reservation_type,
      status: "pending",
      booking_source: input.source_channel,
      booked_by_label: "AI agent",
      source_channel: input.source_channel,
      source_client_id: apiClientId,
    }).select("id").single()
    if (inserted.error) {
      if (String(inserted.error.message).toLowerCase().includes("quota")) throw new ApiDomainError("RESERVATION_CONFLICT", "This restaurant has reached its reservation limit.", false, "choose_another_restaurant", 409)
      throw new ApiDomainError("RESERVATION_CONFLICT", "The reservation could not be created.", true, "retry_request", 409)
    }
    reservationId = inserted.data?.id || null
  }
  if (!reservationId) throw new ApiDomainError("RESERVATION_CONFLICT", "The reservation could not be created.", true, "retry_request", 409)
  return { reservation_id: reservationId, restaurant_id: input.restaurant_id, date: input.date, time: input.time, party_size: input.party_size, timezone: context.restaurant.timezone || "UTC" }
}
