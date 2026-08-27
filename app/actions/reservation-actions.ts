"use server"

import { headers } from "next/headers"
import { createServiceRoleClient } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { sendEmail, MANAGEMENT_EMAIL } from "@/lib/email-service"
import { sendTrackedEmail } from "@/lib/email-delivery"
import { generateReservationConfirmationEmail, generateManagementNotificationEmail, generateUnclaimedBusinessReservationEmail } from "@/lib/reservation-email-templates"
import { formatDate as formatLocalizedDate } from "@/i18n/format"
import { resolveLanguage, type SupportedLanguage } from "@/i18n/config"
import { translate, type TranslationKey } from "@/i18n"
import { sendReservationPushNotification } from "@/lib/push-service"
import {
  getRestaurantEntitlements,
  isRestaurantWithinWorkspacePlanLimit,
  isReservationQuotaError,
  reservationLimitMessage,
} from "@/lib/entitlements"
import {
  fetchActiveReservationAreas,
  fetchRestaurantByName,
  fetchRestaurantBySlug,
  fetchRestaurantMedia,
  isRestaurantPlatformActive,
} from "@/lib/services/public/restaurant-service"
import { buildReservationUpdateSummary } from "@/lib/reservation-update-summary"
import { getPrivacyNoticeContent, type PrivacyNoticeContent } from "@/lib/privacy-notice"
import {
  findBlockedIntervalForReservation,
  normalizeBlockedIntervals,
  validateReservationAvailability,
  validateReservationInput,
  validatePublicReservationContactInput,
} from "@/lib/reservation-validation"
import { resolveRestaurantForHostname } from "@/lib/domains/public-resolver"
import { enforcePublicReservationRateLimit, getRequestClientIdentity } from "@/lib/reservation-rate-limit"
import { createBusinessReservationAccess, getRestaurantClaimProfile, isClaimableSource } from "@/lib/claimable-restaurants"
import { getRestaurantPublicUrl } from "@/lib/domains/public-url"
import { buildCustomerReservationManageUrl } from "@/lib/customer-reservation-links"
import { issueCustomerManagementToken, resolveCustomerManagementToken } from "@/lib/ai/management"

/**
 * Create a reservation (server action).
 * Returns structured result instead of throwing for expected errors, as recommended by Next.js [^5][^2].
 */
interface CreateReservationParams {
  restaurantId: string
  reservationAreaId?: string | null
  partySize: number
  reservationDate: string
  reservationTime: string
  customerName: string
  customerPhone: string
  customerEmail: string
  specialRequests?: string
  tableNumber?: string
  reservationType?: string
  lang?: string
  minGuestAge?: number | null
  maxGuestAge?: number | null
  submissionId?: string
}

export async function getPrivacyNoticeSettings(
  restaurantName?: string | null,
  restaurantPhone?: string | null,
  language?: string | null
): Promise<PrivacyNoticeContent> {
  void restaurantName
  return getPrivacyNoticeContent({ restaurantPhone, language })
}

interface ReservationNotice {
  start_date: string
  end_date: string
  title?: string
  message: string
  active?: boolean
  recurring_weekly?: boolean
  recurring_days?: number[]
}

function normalizeReservationNotices(value: unknown): ReservationNotice[] {
  if (!Array.isArray(value)) return []

  return value.filter((notice): notice is ReservationNotice => (
    Boolean(notice) &&
    typeof notice === "object" &&
    typeof (notice as ReservationNotice).message === "string" &&
    (
      ((notice as ReservationNotice).recurring_weekly === true &&
        Array.isArray((notice as ReservationNotice).recurring_days) &&
        (notice as ReservationNotice).recurring_days!.some((day) => Number.isInteger(day) && day >= 1 && day <= 7)) ||
      (typeof (notice as ReservationNotice).start_date === "string" &&
        typeof (notice as ReservationNotice).end_date === "string")
    )
  ))
}

function getCurrentRestaurantDateTime(timezone: string | null | undefined) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      calendar: "gregory",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date())
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00"
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
  } catch {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, "0")
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  }
}

function isReservationInFuture(reservationDate: string, reservationTime: string, timezone?: string | null) {
  return `${reservationDate}T${reservationTime.slice(0, 5)}` > getCurrentRestaurantDateTime(timezone)
}

function normalizeCustomerEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function normalizeCustomerPhone(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "") : ""
}

function redactGuestContactFromBusinessCopy(value: string | null | undefined, email: string, phone: string) {
  if (!value) return value
  let redacted = value
  if (email) redacted = redacted.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[contact hidden]")
  const phoneDigits = normalizeCustomerPhone(phone)
  if (phoneDigits.length >= 7) {
    redacted = redacted.replace(/[+\d][\d\s().-]{5,}\d/g, (candidate) => normalizeCustomerPhone(candidate) === phoneDigits ? "[contact hidden]" : candidate)
  }
  return redacted
}

const reservationMessageKeys: Record<string, TranslationKey> = {
  "Restaurant information is invalid.": "reserve.messages.restaurantInfoInvalid",
  "Reservation area is invalid.": "reserve.messages.reservationAreaInvalid",
  "Reservation submission is invalid.": "reserve.messages.reservationSubmissionInvalid",
  "Please enter a valid name.": "reserve.messages.validName",
  "Please enter a valid phone number.": "reserve.messages.validPhone",
  "Please enter a valid email address.": "reserve.messages.validEmail",
  "Special requests are too long.": "reserve.messages.specialRequestsTooLong",
  "Table information is invalid.": "reserve.messages.tableInfoInvalid",
  "Reservation type is invalid.": "reserve.messages.reservationTypeInvalid",
  "Language is invalid.": "reserve.messages.languageInvalid",
  "Reservation status is invalid.": "reserve.messages.reservationStatusInvalid",
  "Please select a valid reservation date and time.": "reserve.messages.invalidReservationDateTime",
  "Party size must be a positive whole number.": "reserve.messages.positivePartySize",
  "This restaurant is not accepting reservations right now.": "reserve.messages.restaurantClosed",
  "This restaurant's reservation settings are invalid.": "reserve.messages.invalidReservationSettings",
  "Reservations are not available on the selected day.": "reserve.messages.unavailableDay",
  "Reservations are not available on the selected date.": "reserve.messages.unavailableDate",
  "The selected date is outside the available booking window.": "reserve.messages.outsideBookingWindow",
  "The selected time does not meet the minimum advance booking requirement.": "reserve.messages.minimumAdvance",
  "This restaurant booking link is unavailable.": "reserve.messages.bookingLinkUnavailable",
  "Reservations are temporarily unavailable. Please try again shortly.": "reserve.messages.rateLimited",
  "Reservation created successfully. The team will confirm your reservation shortly.": "reserve.messages.createdSuccess",
  "Restaurant information not found": "reserve.messages.restaurantNotFound",
  "Reservation area information not found": "reserve.messages.areaNotFound",
  "Please select the guest age range.": "reserve.messages.guestAgeRequired",
  "Failed to create reservation": "reserve.messages.createFailed",
  "An unexpected error occurred": "reserve.messages.unexpectedError",
  "An unexpected error occurred.": "reserve.messages.unexpectedError",
  "Reservation not found": "reserve.messages.reservationNotFound",
  "Reservation not found.": "reserve.messages.reservationNotFound",
  "The reservation management link is invalid or has expired.": "reserve.messages.reservationManagementLinkInvalid",
  "This reservation has already been cancelled.": "reserve.messages.alreadyCancelled",
  "The reservation can no longer be edited because its time has passed.": "reserve.messages.editPast",
  "Failed to update reservation": "reserve.messages.updateFailed",
  "Reservation updated successfully": "reserve.messages.updateSuccess",
  "This reservation could not be verified.": "reserve.messages.reservationNotVerified",
  "The reservation can no longer be cancelled because its time has passed.": "reserve.messages.cancellationPast",
  "The reservation could not be cancelled.": "reserve.messages.cancellationFailed",
  "Reservation cancelled successfully.": "reserve.messages.cancelledSuccess",
  "Online reservations are temporarily unavailable. Please contact the restaurant.": "reserve.messages.quotaReached",
  "Reservation availability could not be loaded": "reserve.messages.availabilityLoadFailed",
}

function localizeReservationMessage(message: string, language: SupportedLanguage) {
  const staticKey = reservationMessageKeys[message]
  if (staticKey) return translate(language, staticKey)

  const timeRange = /^Please select a time between (.+) and (.+)\.$/.exec(message)
  if (timeRange) return translate(language, "reserve.messages.timeBetween", { opening: timeRange[1], closing: timeRange[2] })

  const partyRange = /^Party size must be between (.+) and (.+)\.$/.exec(message)
  if (partyRange) return translate(language, "reserve.messages.partySizeBetween", { min: partyRange[1], max: partyRange[2] })

  const fullyBooked = /^We are fully booked between (.+)\.$/.exec(message)
  if (fullyBooked) return translate(language, "reserve.messages.fullyBookedBetween", { ranges: fullyBooked[1] })

  const startsFrom = /^This restaurant accepts reservations starting from (.+)\.$/.exec(message)
  if (startsFrom) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(startsFrom[1])
      ? formatLocalizedDate(startsFrom[1], language, { day: "numeric", month: "long", year: "numeric" })
      : startsFrom[1]
    return translate(language, "reserve.messages.startsFrom", { date })
  }

  const rateLimitFallback = "Reservations are temporarily unavailable. Please try again shortly."
  if (message === rateLimitFallback) return translate(language, "reserve.messages.rateLimited")

  return message
}

export async function createReservation(params: CreateReservationParams) {
  const language = resolveLanguage(params.lang)
  try {
    const contactInputError = validatePublicReservationContactInput({
      ...params,
      restaurantId: params.restaurantId,
      reservationAreaId: params.reservationAreaId,
    })
    if (contactInputError) return { success: false, message: localizeReservationMessage(contactInputError, language) }

    const inputError = validateReservationInput({
      reservationDate: params.reservationDate,
      reservationTime: params.reservationTime,
      partySize: params.partySize,
    })
    if (inputError) {
      return { success: false, message: localizeReservationMessage(inputError, language) }
    }

    // A hosted or customer-owned hostname is a tenant boundary. The browser
    // may submit a forged restaurant ID, but it cannot use that ID to switch
    // the restaurant locked to the request host.
    const requestHeaders = await headers()
    const requestHostname = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || ""
    const hostnameRestaurant = await resolveRestaurantForHostname(requestHostname)
    if (hostnameRestaurant) {
      if (hostnameRestaurant.brand) {
        const brandLocation = hostnameRestaurant.workspaceId
          ? await createServiceRoleClient()
            .from("restaurants")
            .select("id, workspace_id, status, platform_status")
            .eq("id", params.restaurantId)
            .eq("workspace_id", hostnameRestaurant.workspaceId)
            .eq("status", "published")
            .eq("platform_status", "active")
            .maybeSingle()
          : { data: null }
        const allowed = Boolean(brandLocation.data) && hostnameRestaurant.workspaceId
          ? await isRestaurantWithinWorkspacePlanLimit(hostnameRestaurant.workspaceId, params.restaurantId)
          : false
        if (!allowed) return { success: false, message: translate(language, "reserve.messages.bookingLinkUnavailable") }
      } else if (hostnameRestaurant.state !== "resolved" || hostnameRestaurant.restaurantId !== params.restaurantId) {
        return { success: false, message: translate(language, "reserve.messages.bookingLinkUnavailable") }
      }
    }

    if (!(await isRestaurantPlatformActive(params.restaurantId))) {
      return { success: false, message: translate(language, "reserve.messages.bookingLinkUnavailable") }
    }

    const rateLimitResult = await enforcePublicReservationRateLimit({
      restaurantId: params.restaurantId,
      clientIdentity: getRequestClientIdentity(requestHeaders),
    })
    if (!rateLimitResult.allowed) return { success: false, message: localizeReservationMessage(rateLimitResult.message || "Reservations are temporarily unavailable. Please try again shortly.", language) }

    // Use service role to ensure inserts succeed regardless of RLS on public form
    const supabase = createServiceRoleClient()

    if (params.submissionId) {
      const { data: existingSubmission } = await supabase
        .from("reservations")
        .select("*, reservation_areas ( name )")
        .eq("restaurant_id", params.restaurantId)
        .eq("public_submission_id", params.submissionId)
        .maybeSingle()
      if (existingSubmission) {
        return {
          success: true,
          message: translate(language, "reserve.messages.createdSuccess"),
          data: existingSubmission,
          emailSent: false,
        }
      }
    }

    const { data: restaurantSettings, error: restaurantSettingsError } = await supabase
      .from("restaurants")
      .select("reservation_enabled, reservation_start_date, reservation_blocked_intervals, min_party_size, max_party_size")
      .eq("id", params.restaurantId)
      .single()

    if (restaurantSettingsError || !restaurantSettings) {
      console.error("Error fetching restaurant settings:", restaurantSettingsError)
      return { success: false, message: translate(language, "reserve.messages.restaurantNotFound") }
    }

    let preflightClaimProfile: Awaited<ReturnType<typeof getRestaurantClaimProfile>> = null
    try {
      preflightClaimProfile = await getRestaurantClaimProfile(params.restaurantId)
    } catch (claimProfileError) {
      console.error("Could not resolve reservation business email state:", claimProfileError)
      return { success: false, message: "Reservations are temporarily unavailable while the restaurant notification email is being verified." }
    }
    if (preflightClaimProfile?.source === "dataengine" && ["hard_bounce", "paused"].includes(preflightClaimProfile.business_email_delivery_status || "")) {
      return { success: false, message: "Reservations are temporarily unavailable while the restaurant notification email is being corrected." }
    }

    if (restaurantSettings.reservation_enabled === false) {
      return { success: false, message: translate(language, "reserve.messages.restaurantClosed") }
    }

    let areaSettings: { min_party_size: number | null; max_party_size: number | null } | null = null
    if (params.reservationAreaId) {
      const { data, error } = await supabase
        .from("reservation_areas")
        .select("min_party_size, max_party_size")
        .eq("id", params.reservationAreaId)
        .eq("restaurant_id", params.restaurantId)
        .maybeSingle()

      if (error) {
        console.error("Error fetching reservation area settings:", error)
        return { success: false, message: translate(language, "reserve.messages.areaNotFound") }
      }

      areaSettings = data
    }

    const minPartySize = areaSettings?.min_party_size ?? restaurantSettings.min_party_size ?? 1
    const maxPartySize = areaSettings?.max_party_size ?? restaurantSettings.max_party_size ?? 8
    if (!Number.isInteger(params.partySize) || params.partySize < minPartySize || params.partySize > maxPartySize) {
      return { success: false, message: translate(language, "reserve.messages.partySizeBetween", { min: minPartySize, max: maxPartySize }) }
    }

    const { minGuestAge, maxGuestAge } = params
    const hasValidGuestAgeRange =
      typeof minGuestAge === "number" &&
      typeof maxGuestAge === "number" &&
      Number.isInteger(minGuestAge) &&
      Number.isInteger(maxGuestAge) &&
      minGuestAge >= 1 &&
      maxGuestAge <= 65 &&
      minGuestAge <= maxGuestAge

    if (!hasValidGuestAgeRange) {
      return { success: false, message: translate(language, "reserve.messages.guestAgeRequired") }
    }

    if (
      restaurantSettings.reservation_start_date &&
      params.reservationDate < restaurantSettings.reservation_start_date
    ) {
      return {
        success: false,
        message: localizeReservationMessage(`This restaurant accepts reservations starting from ${restaurantSettings.reservation_start_date}.`, language),
      }
    }

    const blockedInterval = findBlockedIntervalForReservation(
      normalizeBlockedIntervals(restaurantSettings.reservation_blocked_intervals),
      params.reservationDate,
      params.reservationTime
    )

    if (blockedInterval) {
      return {
        success: false,
        message: blockedInterval.message || translate(language, "reserve.messages.fullyBookedBetween", {
          ranges: `${blockedInterval.start_time} - ${blockedInterval.end_time}`,
        }),
      }
    }

    const { data, error } = await supabase
      .from("reservations")
      .insert({
        restaurant_id: params.restaurantId,
        reservation_area_id: params.reservationAreaId || null,
        party_size: params.partySize,
        reservation_date: params.reservationDate,
        reservation_time: params.reservationTime,
        customer_name: params.customerName,
        customer_phone: params.customerPhone,
        customer_email: params.customerEmail,
        special_requests: params.specialRequests || null,
        table_number: params.tableNumber || null,
        reservation_type: params.reservationType || "meal",
        status: "pending",
        booking_source: "online",
        booked_by_label: "Online",
        public_submission_id: params.submissionId || null,
      })
      .select(`*, reservation_areas ( name )`)

    if (error) {
      console.error("Error creating reservation:", error)
      if (isReservationQuotaError(error)) {
        return { success: false, message: localizeReservationMessage(reservationLimitMessage(true), language) }
      }
      if (error.code === "23505" && params.submissionId) {
        const { data: existingSubmission } = await supabase
          .from("reservations")
          .select("*, reservation_areas ( name )")
          .eq("restaurant_id", params.restaurantId)
          .eq("public_submission_id", params.submissionId)
          .maybeSingle()
        if (existingSubmission) {
          return {
            success: true,
            message: translate(language, "reserve.messages.createdSuccess"),
            data: existingSubmission,
            emailSent: false,
          }
        }
      }
      return { success: false, message: translate(language, "reserve.messages.createFailed") }
    }

    let pushNotificationsEnabled = true
    try {
      const entitlements = await getRestaurantEntitlements(params.restaurantId)
      if (entitlements) {
        pushNotificationsEnabled = entitlements.features.pushNotifications
      }
    } catch (error) {
      console.error("Could not resolve reservation notification entitlements:", error)
      pushNotificationsEnabled = false
    }

    // Get restaurant details for the email
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id, name, slug, workspace_id")
      .eq("id", params.restaurantId)
      .single()
    const claimProfile = preflightClaimProfile
    const isUnclaimedClaimable = Boolean(
      isClaimableSource(claimProfile?.source) &&
      (claimProfile.ownership_status === "unclaimed" || claimProfile.ownership_status === "claim_pending") &&
      claimProfile.business_contact_email &&
      !["hard_bounce", "paused"].includes(claimProfile.business_email_delivery_status || ""),
    )

    // Format date for email
    const reservationDate = new Date(params.reservationDate)
    const formattedDate = formatLocalizedDate(reservationDate, language, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })

    let emailSent = false
    let emailDisabled = false
    let emailError: unknown = null

    // Reservation email delivery is available on every workspace plan.
    {
      let customerManageUrl: string | undefined
      if (data?.[0]?.id && restaurant?.slug) {
        try {
          const access = await issueCustomerManagementToken({
            reservationId: data[0].id,
            restaurantId: params.restaurantId,
            ttlHours: 168,
          })
          const publicUrl = await getRestaurantPublicUrl({
            id: restaurant.id,
            slug: restaurant.slug,
            workspaceId: restaurant.workspace_id,
          })
          customerManageUrl = buildCustomerReservationManageUrl(publicUrl, access.token, language)
        } catch (error) {
          // The reservation is already created; a token failure must not block the confirmation email.
          console.error("Could not create customer reservation management link:", error)
        }
      }

      const { subject, html, text } = generateReservationConfirmationEmail({
        customerName: params.customerName,
        restaurantName: restaurant?.name || "Reservevia restaurant",
        reservationAreaName: (data?.[0] as any)?.reservation_areas?.name || null,
        reservationDate: formattedDate,
        reservationTime: params.reservationTime,
        partySize: params.partySize,
        reservationType: params.reservationType,
        manageUrl: customerManageUrl,
        lang: language,
      })

      const emailResult = await sendEmail({ to: params.customerEmail, subject, html, text })
      emailSent = emailResult.success
      emailDisabled = Boolean(emailResult.emailDisabled)
      emailError = emailResult.error

      if (!isUnclaimedClaimable) {
        const { subject: mgmtSubject, html: mgmtHtml, text: mgmtText } = generateManagementNotificationEmail({
          action: 'created',
          customerName: params.customerName,
          restaurantName: restaurant?.name || "Reservevia restaurant",
          reservationAreaName: (data?.[0] as any)?.reservation_areas?.name || null,
          reservationDate: formattedDate,
          reservationTime: params.reservationTime,
          partySize: params.partySize,
          customerEmail: params.customerEmail,
          customerPhone: params.customerPhone,
          specialRequests: params.specialRequests,
          reservationId: data?.[0]?.id || 'Unknown',
          reservationType: params.reservationType,
        })
        const mgmtEmailResult = await sendEmail({ to: MANAGEMENT_EMAIL, subject: mgmtSubject, html: mgmtHtml, text: mgmtText })
        if (!mgmtEmailResult.success) console.error("Failed to send management notification email:", mgmtEmailResult.error)
      }
    }

    let businessEmailSent = false
    if (isUnclaimedClaimable && data?.[0]?.id && restaurant?.slug && claimProfile?.business_contact_email) {
      try {
        const access = await createBusinessReservationAccess({ restaurantId: params.restaurantId, reservationId: data[0].id, businessEmail: claimProfile.business_contact_email })
        const publicUrl = await getRestaurantPublicUrl({ id: restaurant.id, slug: restaurant.slug, workspaceId: restaurant.workspace_id })
        const { subject, html, text } = generateUnclaimedBusinessReservationEmail({
          customerName: params.customerName,
          restaurantName: restaurant.name || "Reservevia restaurant",
          reservationAreaName: (data?.[0] as any)?.reservation_areas?.name || null,
          reservationDate: formattedDate,
          reservationTime: params.reservationTime,
          partySize: params.partySize,
          reservationType: params.reservationType,
          specialRequests: redactGuestContactFromBusinessCopy(params.specialRequests, params.customerEmail, params.customerPhone),
          manageUrl: access.manageUrl,
          claimUrl: access.claimUrl,
          publicUrl,
          lang: language,
        })
        const businessEmailResult = await sendTrackedEmail({ to: claimProfile.business_contact_email, subject, html, text }, {
          kind: "unclaimed_business_reservation",
          reservationId: data[0].id,
          restaurantId: params.restaurantId,
          dedupeKey: `unclaimed_business_reservation:${data[0].id}:${claimProfile.business_contact_email.toLowerCase()}`,
          metadata: { template: "unclaimed_business_reservation", language },
        })
        businessEmailSent = businessEmailResult.success
        if (!businessEmailResult.success) {
          console.error("Failed to send unclaimed business notification email:", businessEmailResult.error)
          const retryable = "retryable" in businessEmailResult && businessEmailResult.retryable
          if (!retryable) {
            const failureMessage = businessEmailResult.error && typeof businessEmailResult.error === "object" && "message" in businessEmailResult.error ? String(businessEmailResult.error.message) : "Transactional notification could not be queued."
            await createServiceRoleClient().from("restaurant_claim_profiles").update({ business_email_delivery_status: "paused", business_email_last_error: failureMessage, business_email_paused_at: new Date().toISOString() }).eq("restaurant_id", params.restaurantId).eq("source", "dataengine")
          }
        }
      } catch (error) {
        console.error("Failed to prepare unclaimed business notification email:", error)
        await createServiceRoleClient().from("restaurant_claim_profiles").update({ business_email_delivery_status: "paused", business_email_last_error: error instanceof Error ? error.message : "Transactional notification could not be prepared.", business_email_paused_at: new Date().toISOString() }).eq("restaurant_id", params.restaurantId).eq("source", "dataengine")
      }
    }

    if (pushNotificationsEnabled && data?.[0]?.id) {
      await sendReservationPushNotification(data[0].id, "created").catch((error) => {
        console.error("Failed to send reservation push notification:", error)
      })
    }

    let message = translate(language, "reserve.messages.createdSuccess")

    if (emailDisabled) {
      console.log("Email sending is disabled in this preview environment.")
      message += translate(language, "reserve.messages.emailPreviewNote")
    } else if (!emailSent) {
      console.error("Failed to send confirmation email:", emailError)
    }
    if (isUnclaimedClaimable && !businessEmailSent) message += " The restaurant notification is pending operator review."

    revalidatePath("/reserve")
    revalidatePath("/manage")
    revalidatePath("/manage/reservations")

    return {
      success: true,
      message,
      data: data?.[0],
      emailSent,
      businessEmailSent,
    }
  } catch (error) {
    console.error("Error in createReservation:", error)
    return { success: false, message: translate(language, "reserve.messages.unexpectedError") }
  }
}

/**
  Attempts to fetch a restaurant by name. If Supabase is misconfigured or returns
  a non-JSON response, we log and return a safe fallback instead of throwing,
  per Next.js guidance on expected errors [^1][^2][^5].
*/
export async function getRestaurantByName(name: string) {
  return fetchRestaurantByName(name)
}

export async function getRestaurantBySlug(slug: string) {
  return fetchRestaurantBySlug(slug)
}

// Fetch active reservation areas for a restaurant
export async function getActiveReservationAreas(restaurantId: string) {
  return fetchActiveReservationAreas(restaurantId)
}

export async function getRestaurantMedia(restaurantId: string) {
  return fetchRestaurantMedia(restaurantId)
}

/**
 * Update an existing reservation
 */
interface UpdateReservationParams {
  id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  party_size: number
  reservation_date: string
  reservation_time: string
  special_requests?: string
  table_number?: string
  reservation_type?: string
  lang?: string
}

export async function updateReservation(params: UpdateReservationParams) {
  const language = resolveLanguage(params.lang)
  try {
    const supabase = createServiceRoleClient()

    const { data: existingReservation, error: existingReservationError } = await supabase
      .from("reservations")
      .select(`
        *,
        restaurants (name),
        reservation_areas (name)
      `)
      .eq("id", params.id)
      .single()

    if (existingReservationError || !existingReservation) {
      console.error("Error fetching reservation before update:", existingReservationError)
      return { success: false, message: translate(language, "reserve.messages.reservationNotFound") }
    }

    if (!(await isRestaurantPlatformActive(existingReservation.restaurant_id))) {
      return { success: false, message: translate(language, "reserve.messages.bookingLinkUnavailable") }
    }

    const [{ data: restaurant, error: restaurantError }, areaResult] = await Promise.all([
      supabase
        .from("restaurants")
        .select("reservation_enabled, timezone, opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, allowed_days_of_week, blocked_dates, reservation_start_date, reservation_blocked_intervals, reservation_notices")
        .eq("id", existingReservation.restaurant_id)
        .single(),
      existingReservation.reservation_area_id
        ? supabase
            .from("reservation_areas")
            .select("opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, allowed_days_of_week, blocked_dates")
            .eq("id", existingReservation.reservation_area_id)
            .eq("restaurant_id", existingReservation.restaurant_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (restaurantError || !restaurant) {
      console.error("Error fetching restaurant settings before update:", restaurantError)
      return { success: false, message: translate(language, "reserve.messages.restaurantNotFound") }
    }

    if (areaResult.error) {
      console.error("Error fetching reservation area settings before update:", areaResult.error)
      return { success: false, message: translate(language, "reserve.messages.areaNotFound") }
    }

    if (existingReservation.status === "cancelled") {
      return { success: false, message: translate(language, "reserve.messages.alreadyCancelled") }
    }

    if (!isReservationInFuture(existingReservation.reservation_date, existingReservation.reservation_time, restaurant.timezone)) {
      return { success: false, message: translate(language, "reserve.messages.editPast") }
    }

    const availabilityError = validateReservationAvailability(params, restaurant, areaResult.data)
    if (availabilityError) {
      return { success: false, message: localizeReservationMessage(availabilityError, language) }
    }

    const { data, error } = await supabase
      .from("reservations")
      .update({
        customer_name: params.customer_name,
        customer_email: params.customer_email,
        customer_phone: params.customer_phone,
        party_size: params.party_size,
        reservation_date: params.reservation_date,
        reservation_time: params.reservation_time,
        special_requests: params.special_requests || null,
        table_number: params.table_number || null,
        // Any customer-initiated edits should put reservation back to pending
        status: 'pending',
      })
      .eq("id", params.id)
      .select(`
        *,
        restaurants (name),
        reservation_areas (name)
      `)

    if (error) {
      console.error("Error updating reservation:", error)
      return { success: false, message: translate(language, "reserve.messages.updateFailed"), error }
    }

    // Get updated reservation data
    let updatedReservation = data?.[0]
    if (updatedReservation) {
      let pushNotificationsEnabled = true
      try {
        const entitlements = await getRestaurantEntitlements(existingReservation.restaurant_id)
        if (entitlements) {
          pushNotificationsEnabled = entitlements.features.pushNotifications
        }
      } catch (error) {
        console.error("Could not resolve reservation notification entitlements:", error)
        pushNotificationsEnabled = false
      }

      const updateSummary = buildReservationUpdateSummary(existingReservation, updatedReservation, {
        source: "customer",
      })

      if (updateSummary) {
        const { data: summaryData, error: summaryError } = await supabase
          .from("reservations")
          .update({
            last_update_summary: updateSummary,
            last_updated_by_user_id: null,
          })
          .eq("id", params.id)
          .select(`
            *,
            restaurants (name),
            reservation_areas (name)
          `)

        if (summaryError) {
          console.error("Error saving customer reservation update summary:", summaryError)
          updatedReservation = { ...updatedReservation, last_update_summary: updateSummary, last_updated_by_user_id: null }
        } else {
          updatedReservation = summaryData?.[0] || updatedReservation
        }
      }

      // Format date for email
      const reservationDate = new Date(params.reservation_date)
      const formattedDate = formatLocalizedDate(reservationDate, language, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })

      // Reservation email delivery is available on every workspace plan.
      const { subject: mgmtSubject, html: mgmtHtml, text: mgmtText } = generateManagementNotificationEmail({
        action: 'updated',
        customerName: params.customer_name,
        restaurantName: updatedReservation.restaurants?.name || "Reservevia restaurant",
        reservationAreaName: (updatedReservation as any)?.reservation_areas?.name || null,
        reservationDate: formattedDate,
        reservationTime: params.reservation_time,
        partySize: params.party_size,
        customerEmail: params.customer_email,
        customerPhone: params.customer_phone,
        specialRequests: params.special_requests,
        reservationId: params.id,
        reservationType: params.reservation_type,
      })

      {
        const mgmtEmailResult = await sendEmail({
          to: MANAGEMENT_EMAIL,
          subject: mgmtSubject,
          html: mgmtHtml,
          text: mgmtText,
        })

        if (!mgmtEmailResult.success) {
          console.error("Failed to send management notification email:", mgmtEmailResult.error)
        }
      }

      if (pushNotificationsEnabled) {
        await sendReservationPushNotification(params.id, "updated").catch((error) => {
          console.error("Failed to send reservation push notification:", error)
        })
      }
    }

    revalidatePath("/manage/reservations")
    revalidatePath("/reserve")

    return {
      success: true,
      message: translate(language, "reserve.messages.updateSuccess"),
      data: updatedReservation,
    }
  } catch (error) {
    console.error("Error in updateReservation:", error)
    return { success: false, message: translate(language, "reserve.messages.unexpectedError") }
  }
}

export async function getCustomerReservationByToken(token: string, lang?: string, expectedRestaurantSlug?: string) {
  const language = resolveLanguage(lang)
  try {
    const reservation = await resolveCustomerManagementToken(token)
    const restaurant = reservation.restaurant
    if (expectedRestaurantSlug && restaurant?.slug !== expectedRestaurantSlug) {
      return {
        success: false,
        message: translate(language, "reserve.messages.reservationManagementLinkInvalid"),
      }
    }
    return {
      success: true,
      data: {
        id: reservation.id,
        restaurant_slug: restaurant?.slug,
        restaurant_name: restaurant?.name || "",
        customer_name: reservation.customer_name,
        customer_email: reservation.customer_email || "",
        customer_phone: reservation.customer_phone,
        party_size: reservation.party_size,
        reservation_date: reservation.reservation_date,
        reservation_time: String(reservation.reservation_time).slice(0, 5),
        special_requests: reservation.special_requests || undefined,
        status: reservation.status,
        notes: null,
        created_at: new Date().toISOString(),
      },
    }
  } catch (error) {
    console.error("Could not resolve customer reservation management link:", error)
    return {
      success: false,
      message: translate(language, "reserve.messages.reservationManagementLinkInvalid"),
    }
  }
}

export async function updateReservationWithManagementToken(token: string, params: UpdateReservationParams) {
  const language = resolveLanguage(params.lang)
  try {
    await resolveCustomerManagementToken(token, params.id)
    return updateReservation(params)
  } catch (error) {
    console.error("Could not authorize customer reservation update:", error)
    return {
      success: false,
      message: translate(language, "reserve.messages.reservationManagementLinkInvalid"),
    }
  }
}

interface CancelReservationParams {
  id: string
  customer_email: string
  customer_phone: string
  lang?: string
}

export async function cancelReservation(params: CancelReservationParams) {
  const language = resolveLanguage(params.lang)
  try {
    const supabase = createServiceRoleClient()
    const { data: existingReservation, error: existingReservationError } = await supabase
      .from("reservations")
      .select(`
        id,
        restaurant_id,
        customer_email,
        customer_phone,
        reservation_date,
        reservation_time,
        status,
        restaurants (name, timezone),
        reservation_areas (name)
      `)
      .eq("id", params.id)
      .maybeSingle()

    if (existingReservationError || !existingReservation) {
      return { success: false, message: translate(language, "reserve.messages.reservationNotFound") }
    }

    const emailMatches = normalizeCustomerEmail(existingReservation.customer_email) === normalizeCustomerEmail(params.customer_email)
    const phoneMatches = normalizeCustomerPhone(existingReservation.customer_phone) === normalizeCustomerPhone(params.customer_phone)
    if (!emailMatches || !phoneMatches) {
      return { success: false, message: translate(language, "reserve.messages.reservationNotVerified") }
    }

    if (existingReservation.status === "cancelled") {
      return { success: true, message: translate(language, "reserve.messages.alreadyCancelled"), data: existingReservation }
    }

    const restaurant = Array.isArray(existingReservation.restaurants) ? existingReservation.restaurants[0] : existingReservation.restaurants
    if (!isReservationInFuture(existingReservation.reservation_date, existingReservation.reservation_time, restaurant?.timezone)) {
      return { success: false, message: translate(language, "reserve.messages.cancellationPast") }
    }

    const { data: cancelledReservation, error: cancelError } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", params.id)
      .neq("status", "cancelled")
      .select(`
        *,
        restaurants (name, timezone),
        reservation_areas (name)
      `)
      .maybeSingle()

    if (cancelError || !cancelledReservation) {
      console.error("Error cancelling reservation:", cancelError)
      return { success: false, message: translate(language, "reserve.messages.cancellationFailed") }
    }

    const updateSummary = buildReservationUpdateSummary(existingReservation, cancelledReservation, { source: "customer" })
    if (updateSummary) {
      const { error: summaryError } = await supabase
        .from("reservations")
        .update({ last_update_summary: updateSummary, last_updated_by_user_id: null })
        .eq("id", params.id)
      if (summaryError) console.error("Error saving customer cancellation summary:", summaryError)
    }

    try {
      const entitlements = await getRestaurantEntitlements(existingReservation.restaurant_id)
      if (entitlements?.features.pushNotifications) {
        await sendReservationPushNotification(params.id, "cancelled")
      }
    } catch (error) {
      console.error("Failed to resolve or send customer cancellation push notification:", error)
    }

    revalidatePath("/manage/reservations")
    revalidatePath("/reserve")

    return { success: true, message: translate(language, "reserve.messages.cancelledSuccess"), data: cancelledReservation }
  } catch (error) {
    console.error("Error cancelling reservation:", error)
    return { success: false, message: translate(language, "reserve.messages.unexpectedError") }
  }
}

export async function cancelReservationWithManagementToken(token: string, reservationId: string, lang?: string) {
  const language = resolveLanguage(lang)
  try {
    const reservation = await resolveCustomerManagementToken(token, reservationId)
    return cancelReservation({
      id: reservation.id,
      customer_email: reservation.customer_email || "",
      customer_phone: reservation.customer_phone,
      lang: language,
    })
  } catch (error) {
    console.error("Could not authorize customer reservation cancellation:", error)
    return {
      success: false,
      message: translate(language, "reserve.messages.reservationManagementLinkInvalid"),
    }
  }
}

/**
 * Fetch reservation status and notes by ID for customer display
 */
export async function getReservationStatus(id: string, lang?: string) {
  const language = resolveLanguage(lang)
  try {
    const supabase = createServiceRoleClient()

    const { data, error } = await supabase
      .from("reservations")
      .select("id, status, notes")
      .eq("id", id)
      .maybeSingle()

    if (error) {
      console.error("Error fetching reservation status:", error)
      return { success: false, message: translate(language, "reserve.messages.statusLoadFailed") }
    }

    if (!data) {
      return { success: false, message: translate(language, "reserve.messages.reservationNotFound") }
    }

    return { success: true, data }
  } catch (error) {
    console.error("Error in getReservationStatus:", error)
    return { success: false, message: translate(language, "reserve.messages.unexpectedError") }
  }
}

/**
 * Returns the public booking constraints for the reservation's existing area.
 * The customer edit form uses these to show only valid dates and time slots.
 */
export async function getReservationEditAvailability(id: string, lang?: string) {
  const language = resolveLanguage(lang)
  try {
    const supabase = createServiceRoleClient()
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("restaurant_id, reservation_area_id")
      .eq("id", id)
      .single()

    if (reservationError || !reservation) {
      return { success: false, message: translate(language, "reserve.messages.reservationNotFound") }
    }

    if (!(await isRestaurantPlatformActive(reservation.restaurant_id))) {
      return { success: false, message: translate(language, "reserve.messages.bookingLinkUnavailable") }
    }

    const [{ data: restaurant, error: restaurantError }, areaResult] = await Promise.all([
      supabase
        .from("restaurants")
        .select("reservation_enabled, opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, allowed_days_of_week, blocked_dates, reservation_start_date, reservation_blocked_intervals, reservation_notices")
        .eq("id", reservation.restaurant_id)
        .single(),
      reservation.reservation_area_id
        ? supabase
            .from("reservation_areas")
            .select("opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, allowed_days_of_week, blocked_dates")
            .eq("id", reservation.reservation_area_id)
            .eq("restaurant_id", reservation.restaurant_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (restaurantError || !restaurant || areaResult.error) {
      console.error("Error fetching reservation availability:", restaurantError || areaResult.error)
      return { success: false, message: translate(language, "reserve.messages.availabilityLoadFailed") }
    }

    const area = areaResult.data
    return {
      success: true,
      data: {
        reservationEnabled: restaurant.reservation_enabled !== false,
        openingTime: area?.opening_time || restaurant.opening_time || "17:00",
        closingTime: area?.closing_time || restaurant.closing_time || "20:45",
        slotDuration: area?.time_slot_duration ?? restaurant.time_slot_duration ?? 15,
        advanceBookingDays: area?.advance_booking_days ?? restaurant.advance_booking_days ?? 15,
        minAdvanceHours: area?.min_advance_hours ?? restaurant.min_advance_hours ?? 0,
        minPartySize: area?.min_party_size ?? restaurant.min_party_size ?? 1,
        maxPartySize: area?.max_party_size ?? restaurant.max_party_size ?? 8,
        allowedDays: area?.allowed_days_of_week || restaurant.allowed_days_of_week || [1, 2, 3, 4, 5, 6, 7],
        blockedDates: area?.blocked_dates || restaurant.blocked_dates || [],
        reservationStartDate: restaurant.reservation_start_date,
        blockedIntervals: normalizeBlockedIntervals(restaurant.reservation_blocked_intervals),
        notices: normalizeReservationNotices(restaurant.reservation_notices),
      },
    }
  } catch (error) {
    console.error("Error in getReservationEditAvailability:", error)
    return { success: false, message: translate(language, "reserve.messages.unexpectedError") }
  }
}
