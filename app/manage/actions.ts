"use server"

import { createServiceRoleClient } from "@/lib/supabase"
import { canWrite, coerceRestaurantFilter, getUserRestaurantIds, getCurrentUserAccess, scopeContainsRestaurant } from "@/lib/auth-utils"
import {
  requireRestaurantManagementAccess,
  requireWorkspaceCreationAccess,
} from "@/lib/authorization"
import { revalidatePath } from "next/cache"
import { sendEmail } from "@/lib/email-service"
import { generateStatusUpdateEmail } from "@/lib/reservation-email-templates"
import { formatDate as formatLocalizedDate } from "@/i18n/format"
import { resolveLanguage } from "@/i18n/config"
import { generateICSFile } from "@/lib/calendar-invite"
import { fetchManagedRestaurants, fetchPublicRestaurants } from "@/lib/services/manage/restaurant-service"
import { getRestaurantPublicUrl } from "@/lib/domains/public-url"
import { GENERIC_RESTAURANT_MEDIA_FALLBACK, getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"
import { buildCustomerReservationManageUrl } from "@/lib/customer-reservation-links"
import { issueCustomerManagementToken } from "@/lib/ai/management"
import { provisionRestaurantWorkspace } from "@/lib/restaurant-provisioning"
import { normalizeOfficialWebsiteUrl } from "@/lib/claimable-restaurants"
import { sendReservationPushNotification } from "@/lib/push-service"
import { buildReservationUpdateSummary } from "@/lib/reservation-update-summary"
import { isReservationStatus } from "@/lib/reservation-validation"
import {
  RESERVED_RESTAURANT_SLUGS,
  normalizeProfileVisibility,
  normalizeSocialLinks,
  appendRestaurantSlugSuffix,
  slugifyRestaurantName,
  validateOptionalPublicUrl,
  validateRestaurantSlug,
  validateSocialLinks,
  type RestaurantProfileInput,
} from "@/lib/restaurant-profile"
import {
  EntitlementError,
  assertWithinLimit,
  getRestaurantEntitlements,
  getHistoryCutoffsForRestaurants,
  getWorkspaceEntitlements,
  getWorkspaceRestaurantPlanState,
  getWorkspaceUsage,
  isRestaurantWithinWorkspacePlanLimit,
  isReservationVisibleInHistory,
  isReservationQuotaError,
  reservationLimitMessage,
  restaurantCreationReason,
} from "@/lib/entitlements"

const BOOKING_SOURCES = new Set(["online", "phone", "whatsapp", "email", "walk_in", "staff", "social_media", "maps", "other"])

const MANAGE_RESERVATION_SELECT = `
  id,
  restaurant_id,
  reservation_area_id,
  reservation_date,
  reservation_time,
  customer_name,
  customer_email,
  customer_phone,
  party_size,
  status,
  reservation_type,
  table_number,
  special_requests,
  notes,
  booking_source,
  created_at,
  updated_at,
  booked_by_user_id,
  booked_by_label,
  last_updated_by_user_id,
  last_update_summary,
  public_submission_id,
  restaurants (id, name),
  reservation_areas (id, name)
`

async function findAvailableRestaurantSlug(
  supabase: ReturnType<typeof createServiceRoleClient>,
  baseSlug: string,
  currentRestaurantId?: string,
) {
  for (let suffix = 2; suffix <= 1000; suffix += 1) {
    const candidate = appendRestaurantSlugSuffix(baseSlug, suffix)
    let query = supabase.from("restaurants").select("id").eq("slug", candidate)
    if (currentRestaurantId) query = query.neq("id", currentRestaurantId)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    if (!data) return candidate
  }
  throw new Error("Could not find an available restaurant slug.")
}

async function reservationAreaBelongsToRestaurant(
  supabase: ReturnType<typeof createServiceRoleClient>,
  reservationAreaId: string,
  restaurantId: string,
) {
  const { data, error } = await supabase
    .from("reservation_areas")
    .select("id")
    .eq("id", reservationAreaId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle()

  return !error && Boolean(data)
}

function sanitizeReservationSearchTerm(value: string) {
  return value
    .trim()
    .replace(/[\\%_*(),]/g, " ")
    .replace(/\s+/g, " ")
}

async function attachBookedByEmail<T extends { booked_by_user_id?: string | null; booked_by_email?: string | null }>(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: T | null
): Promise<T | null> {
  if (!row?.booked_by_user_id) {
    return row
  }

  try {
    const { data, error } = await supabase.auth.admin.getUserById(row.booked_by_user_id)
    if (!error && data.user?.email) {
      return { ...row, booked_by_email: data.user.email }
    }
  } catch (error) {
    console.warn(`Could not fetch auth user email for ${row.booked_by_user_id}:`, error)
  }

  return row
}

type ReservationRow = {
  booked_by_user_id?: string | null
  booked_by_label?: string | null
  booked_by_name?: string | null
  [key: string]: any
}

type ReservationNoticeInput = {
  start_date: string
  end_date: string
  title?: string
  message: string
  active?: boolean
  recurring_weekly?: boolean
  recurring_days?: number[]
}

export async function getReservations(filters: {
  status?: string
  restaurantId?: string
  dateRange?: string
  searchQuery?: string
  reservationId?: string
}) {
  try {
    const supabase = createServiceRoleClient()

    // Enforce restaurant scope
    const scope = await coerceRestaurantFilter(filters.restaurantId)
    if (scope.type === "deny") {
      return { success: true, data: [] }
    }

    let query = supabase.from("reservations").select(MANAGE_RESERVATION_SELECT)

    // Apply filters if provided
    if (filters.status && filters.status !== "all") {
      query = query.eq("status", filters.status)
    }

    if (scope.type === "one" && scope.id) {
      query = query.eq("restaurant_id", scope.id)
    }
    if (scope.type === "many") {
      query = query.in("restaurant_id", scope.ids)
    }

    const historyCutoffs = scope.type === "one"
      ? await getHistoryCutoffsForRestaurants([scope.id])
      : scope.type === "many"
        ? await getHistoryCutoffsForRestaurants(scope.ids)
        : new Map<string, string | null>()
    const finiteCutoffs = Array.from(historyCutoffs.values()).filter((cutoff): cutoff is string => Boolean(cutoff))
    const earliestCutoff = finiteCutoffs.sort()[0]
    if (earliestCutoff) query = query.gte("reservation_date", earliestCutoff)

    if (filters.reservationId?.trim()) {
      query = query.eq("id", filters.reservationId.trim())
    }

    // Search in the database so reservations older than Supabase's default
    // response limit are still discoverable. Related restaurant and area names
    // are resolved to IDs first because PostgREST cannot filter embedded rows
    // through the parent reservation query.
    const searchTerm = filters.searchQuery ? sanitizeReservationSearchTerm(filters.searchQuery) : ""
    if (searchTerm) {
      const [{ data: matchingRestaurants }, { data: matchingAreas }] = await Promise.all([
        supabase.from("restaurants").select("id").ilike("name", `%${searchTerm}%`),
        supabase.from("reservation_areas").select("id").ilike("name", `%${searchTerm}%`),
      ])

      const searchFilters = [
        `customer_name.ilike.*${searchTerm}*`,
        `customer_phone.ilike.*${searchTerm}*`,
        `customer_email.ilike.*${searchTerm}*`,
        ...(matchingRestaurants || []).map(({ id }) => `restaurant_id.eq.${id}`),
        ...(matchingAreas || []).map(({ id }) => `reservation_area_id.eq.${id}`),
      ]

      query = query.or(searchFilters.join(","))
    }

    // Handle date range filtering
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Helper function to format date without timezone issues
    const formatDateToYYYYMMDD = (date: Date) => {
      const year = date.getFullYear()
      const month = (date.getMonth() + 1).toString().padStart(2, "0")
      const day = date.getDate().toString().padStart(2, "0")
      return `${year}-${month}-${day}`
    }

    if (filters.dateRange === "today") {
      query = query.eq("reservation_date", formatDateToYYYYMMDD(today))
    } else if (filters.dateRange === "tomorrow") {
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      query = query.eq("reservation_date", formatDateToYYYYMMDD(tomorrow))
    } else if (filters.dateRange === "week") {
      const endOfWeek = new Date(today)
      endOfWeek.setDate(endOfWeek.getDate() + 7)
      query = query
        .gte("reservation_date", formatDateToYYYYMMDD(today))
        .lte("reservation_date", formatDateToYYYYMMDD(endOfWeek))
    } else if (filters.dateRange === "month") {
      const endOfMonth = new Date(today)
      endOfMonth.setMonth(endOfMonth.getMonth() + 1)
      query = query
        .gte("reservation_date", formatDateToYYYYMMDD(today))
        .lte("reservation_date", formatDateToYYYYMMDD(endOfMonth))
    }

    // Show newest reservations first, then keep date/time as a secondary sort for same-day entries.
    const { data: allData, error: initialError } = await query
      .order("created_at", { ascending: false })
      .order("reservation_date", { ascending: false })
      .order("reservation_time", { ascending: false })
    
    if (initialError) {
      console.error("Error fetching reservations:", initialError)
      return { success: false, message: initialError.message, data: [] }
    }

    const filteredData = (allData || []).filter((row) => {
      const cutoff = historyCutoffs.get(row.restaurant_id)
      return !cutoff || isReservationVisibleInHistory(row.reservation_date, cutoff)
    })

    // Resolve display names for the creator/booking source.
    const creatorIds = Array.from(
      new Set(
        (filteredData || [])
          .map((row) => row.booked_by_user_id)
          .filter((id): id is string => Boolean(id))
      )
    )

    const creatorMap = new Map<string, string>()
    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("admin_profiles")
        .select("id, full_name")
        .in("id", creatorIds)

      for (const profile of profiles || []) {
        const name = profile.full_name?.trim()
        if (name) {
          creatorMap.set(profile.id, name)
        }
      }

      const missingCreatorIds = creatorIds.filter((id) => !creatorMap.has(id))
      await Promise.all(
        missingCreatorIds.map(async (id) => {
          const { data: authUser } = await supabase.auth.admin.getUserById(id)
          const email = authUser.user?.email?.trim()
          if (email) {
            creatorMap.set(id, email)
          }
        })
      )
    }

    const getBookedByName = (row: ReservationRow) => {
      const manualLabel = row.booked_by_label?.trim()
      if (manualLabel) {
        return manualLabel
      }

      if (row.booked_by_user_id) {
        return creatorMap.get(row.booked_by_user_id) || "Staff"
      }

      return "Online"
    }

    const mappedData = (filteredData || []).map((row) => ({
      ...row,
      booked_by_name: getBookedByName(row),
    }))

    return { success: true, data: mappedData }
  } catch (error) {
    console.error("Error in getReservations:", error)
    return { success: false, message: error instanceof Error ? error.message : "An unexpected error occurred", data: [] }
  }
}

export async function updateReservationStatus(id: string, status: string, notes?: string, sendNotification = true, lang: string = 'en') {
  try {
    if (!isReservationStatus(status)) {
      return { success: false, message: "Invalid reservation status" }
    }
    console.log(`Updating reservation ${id} to status: ${status}, sendNotification: ${sendNotification}`)

    const supabase = createServiceRoleClient()
    const access = await getCurrentUserAccess()
    if (!canWrite(access)) {
      return { success: false, message: "Forbidden" }
    }

    const updateData: any = { status }
    if (notes !== undefined) {
      updateData.notes = notes
    }

    // First, get the reservation details
    const { data: reservation, error: fetchError } = await supabase
      .from("reservations")
      .select(`
        *,
        restaurants (id, name, location, slug, workspace_id),
        reservation_areas (name)
      `)
      .eq("id", id)
      .single()

    if (fetchError) {
      console.error("Error fetching reservation:", fetchError)
      return { success: false, message: fetchError.message }
    }

    console.log("Retrieved reservation:", reservation)

    // Authorization: ensure user can update this reservation (restaurant scoped)
    const scope = await coerceRestaurantFilter(reservation?.restaurant_id)
    if (scope.type === "deny") {
      return { success: false, message: "Forbidden" }
    }
    if (!scopeContainsRestaurant(scope, reservation?.restaurant_id)) {
      return { success: false, message: "Forbidden" }
    }

    // Update the reservation status and return the complete row for optimistic dashboard updates.
    const { data: updatedReservation, error } = await supabase
      .from("reservations")
      .update(updateData)
      .eq("id", id)
      .select(`
        *,
        restaurants (id, name),
        reservation_areas (id, name)
      `)
      .single()

    if (error) {
      console.error("Error updating reservation status:", error)
      return { success: false, message: error.message }
    }

    console.log("Successfully updated reservation status in database")

    let pushNotificationsEnabled = true
    try {
      const entitlements = await getRestaurantEntitlements(reservation.restaurant_id)
      if (entitlements) {
        pushNotificationsEnabled = entitlements.features.pushNotifications
      }
    } catch (error) {
      console.error("Could not resolve reservation notification entitlements:", error)
      pushNotificationsEnabled = false
    }

    // Reservation email delivery is available on every workspace plan.
    if (sendNotification && reservation.customer_email) {
      console.log(`Preparing to send email to ${reservation.customer_email}`)

      const isConfirmation = status === "confirmed"

      // Format date for email
      const reservationDate = new Date(reservation.reservation_date)
      const language = resolveLanguage(lang)
      const formattedDate = formatLocalizedDate(reservationDate, language, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })

      let customerManageUrl: string | undefined
      if (reservation.restaurants?.slug) {
        try {
          const access = await issueCustomerManagementToken({
            reservationId: id,
            restaurantId: reservation.restaurant_id,
            ttlHours: 168,
          })
          const publicUrl = await getRestaurantPublicUrl({
            id: reservation.restaurant_id,
            slug: reservation.restaurants.slug,
            workspaceId: reservation.restaurants.workspace_id,
          })
          customerManageUrl = buildCustomerReservationManageUrl(publicUrl, access.token, language)
        } catch (error) {
          console.error("Could not create customer reservation management link for status email:", error)
        }
      }

      const { subject, html, text } = generateStatusUpdateEmail({
        customerName: reservation.customer_name,
        restaurantName: reservation.restaurants.name,
        reservationAreaName: (reservation as any)?.reservation_areas?.name || null,
        reservationDate: formattedDate,
        reservationTime: reservation.reservation_time,
        partySize: reservation.party_size,
        status: status === "confirmed" ? "confirmed" : "cancelled",
        notes: notes,
        reservationType: reservation.reservation_type,
        manageUrl: status === "confirmed" ? customerManageUrl : undefined,
        lang: language,
      })

      // Only generate calendar invite for confirmed reservations
      let attachments: { filename: string; content: string }[] = []

      if (isConfirmation) {
        try {
          // Parse the reservation time
          const [hours, minutes] = reservation.reservation_time.split(":").map(Number)

          // Create start and end dates for the reservation
          const startDate = new Date(reservation.reservation_date)
          startDate.setHours(hours, minutes, 0, 0)

          const endDate = new Date(startDate)
          endDate.setHours(endDate.getHours() + 2) // Assuming 2 hours for dining

          // Generate the calendar invite
          const icsContent = generateICSFile({
            summary: `Reservation at ${reservation.restaurants.name}`,
            description: `Your reservation for ${reservation.party_size} people at ${reservation.restaurants.name}.\n\n${notes || ""}`,
            location: reservation.restaurants.location || `${reservation.restaurants.name}`,
            startDate,
            endDate,
            organizerName: "Reservevia",
            organizerEmail: process.env.RESERVEVIA_SYSTEM_EMAIL_REPLY_TO || "support@reservevia.com",
          })

          attachments = [
            {
              filename: "reservation.ics",
              content: icsContent,
            },
          ]

          console.log("Generated calendar invite attachment")
        } catch (error) {
          console.error("Error generating calendar invite:", error)
          // Continue without the calendar invite if there's an error
        }
      }

      try {
        console.log("Sending email with subject:", subject)

        const emailResult = await sendEmail({
          to: reservation.customer_email,
          subject,
          html,
          text,
          attachments,
        })

        if (!emailResult.success) {
          console.error(`Failed to send ${status} email:`, emailResult.error)
          // We still return success for the status update, but log the email failure
        } else {
          console.log("Email sent successfully:", emailResult.data)
        }
      } catch (error) {
        console.error("Error sending email:", error)
        // Continue with the status update even if email sending fails
      }
    } else {
      console.log(
        `Email notification skipped. sendNotification: ${sendNotification}, email: ${reservation.customer_email}`,
      )
    }

    if (pushNotificationsEnabled) {
      await sendReservationPushNotification(id, status === "cancelled" ? "cancelled" : "updated").catch((error) => {
        console.error("Failed to send reservation push notification:", error)
      })
    }

    revalidatePath("/manage/reservations")

    return {
      success: true,
      data: await attachBookedByEmail(supabase, updatedReservation),
      message: `Reservation ${status} successfully`,
    }
  } catch (error) {
    console.error("Error in updateReservationStatus:", error)
    return { success: false, message: "An unexpected error occurred" }
  }
}

// Add a function to get all reservations without filters for debugging
export async function getAllReservations() {
  try {
    const supabase = createServiceRoleClient()
    const scope = await coerceRestaurantFilter()
    if (scope.type === "deny") return { success: true, data: [] }
    let query = supabase
      .from("reservations")
      .select(`
        *,
        restaurants (id, name)
      `)
      .order("created_at", { ascending: false })
    if (scope.type === "one") query = query.eq("restaurant_id", scope.id)
    if (scope.type === "many") query = query.in("restaurant_id", scope.ids)

    const historyCutoffs = scope.type === "one"
      ? await getHistoryCutoffsForRestaurants([scope.id])
      : scope.type === "many"
        ? await getHistoryCutoffsForRestaurants(scope.ids)
        : new Map<string, string | null>()
    const finiteCutoffs = Array.from(historyCutoffs.values()).filter((cutoff): cutoff is string => Boolean(cutoff))
    const earliestCutoff = finiteCutoffs.sort()[0]
    if (earliestCutoff) query = query.gte("reservation_date", earliestCutoff)

    const { data, error } = await query

    if (error) {
      console.error("Error fetching all reservations:", error)
      return { success: false, message: error instanceof Error ? error.message : "An unexpected error occurred", data: [] }
    }

    const filteredData = (data || []).filter((row) => {
      const cutoff = historyCutoffs.get(row.restaurant_id)
      return !cutoff || isReservationVisibleInHistory(row.reservation_date, cutoff)
    })
    return { success: true, data: filteredData }
  } catch (error) {
    console.error("Error in getAllReservations:", error)
    return { success: false, message: "An unexpected error occurred", data: [] }
  }
}

export async function createReservation(reservationData: {
  restaurant_id: string
  reservation_area_id?: string | null
  customer_name: string
  customer_email: string
  customer_phone: string
  party_size: number
  reservation_date: string
  reservation_time: string
  special_requests?: string
  status?: string
  reservation_type?: string
  booking_source?: string
}) {
  try {
    if (reservationData.status !== undefined && !isReservationStatus(reservationData.status)) {
      return { success: false, message: "Invalid reservation status" }
    }
    const supabase = createServiceRoleClient()
    const access = await getCurrentUserAccess()
    if (!canWrite(access)) {
      return { success: false, message: "Forbidden" }
    }
    if (!reservationData.booking_source || !BOOKING_SOURCES.has(reservationData.booking_source)) {
      return { success: false, message: "A valid booking source is required" }
    }
    const normalizedSpecialRequests = reservationData.special_requests?.trim() || null
    const scope = await coerceRestaurantFilter(reservationData.restaurant_id)
    if (scope.type === "deny") {
      return { success: false, message: "Forbidden" }
    }
    if (!scopeContainsRestaurant(scope, reservationData.restaurant_id)) {
      return { success: false, message: "Forbidden" }
    }
    const { data: targetRestaurant, error: targetRestaurantError } = await supabase
      .from("restaurants")
      .select("workspace_id")
      .eq("id", reservationData.restaurant_id)
      .maybeSingle()
    if (targetRestaurantError || !targetRestaurant) return { success: false, message: "Restaurant not found" }
    if (targetRestaurant.workspace_id && !(await isRestaurantWithinWorkspacePlanLimit(targetRestaurant.workspace_id, reservationData.restaurant_id))) {
      return { success: false, message: "This restaurant is offline because of the current plan limit." }
    }
    if (
      reservationData.reservation_area_id &&
      !(await reservationAreaBelongsToRestaurant(
        supabase,
        reservationData.reservation_area_id,
        reservationData.restaurant_id,
      ))
    ) {
      return { success: false, message: "Reservation area does not belong to this restaurant" }
    }

    const { data, error } = await supabase
      .from("reservations")
      .insert({
        ...reservationData,
        notes: normalizedSpecialRequests,
        reservation_area_id: reservationData.reservation_area_id ? reservationData.reservation_area_id : null,
        status: reservationData.status || "pending",
        booked_by_user_id: access?.userId ?? null,
      })
      .select(`
        *,
        restaurants (id, name),
        reservation_areas (id, name)
      `)
      .single()

    if (error) {
      console.error("Error creating reservation:", error)
      if (isReservationQuotaError(error)) {
        return { success: false, message: reservationLimitMessage(false) }
      }
      return { success: false, message: error.message }
    }

    revalidatePath("/manage/reservations")
    try {
      const entitlements = await getRestaurantEntitlements(data.restaurant_id)
      if (entitlements?.features.pushNotifications) {
        await sendReservationPushNotification(data.id, "created")
      }
    } catch (error) {
      console.error("Failed to resolve or send reservation push notification:", error)
    }

    return { success: true, data: await attachBookedByEmail(supabase, data), message: "Reservation created successfully" }
  } catch (error) {
    console.error("Error in createReservation:", error)
    return { success: false, message: "An unexpected error occurred" }
  }
}

export async function updateReservation(id: string, reservationData: {
  restaurant_id?: string
  reservation_area_id?: string | null
  customer_name?: string
  customer_email?: string
  customer_phone?: string
  party_size?: number
  reservation_date?: string
  reservation_time?: string
  special_requests?: string
  status?: string
  table_number?: string
  reservation_type?: string
  booking_source?: string
}) {
  try {
    if (reservationData.status !== undefined && !isReservationStatus(reservationData.status)) {
      return { success: false, message: "Invalid reservation status" }
    }
    const supabase = createServiceRoleClient()
    const access = await getCurrentUserAccess()
    if (!canWrite(access)) {
      return { success: false, message: "Forbidden" }
    }
    if (reservationData.booking_source !== undefined && !BOOKING_SOURCES.has(reservationData.booking_source)) {
      return { success: false, message: "A valid booking source is required" }
    }
    const shouldSyncNotes = reservationData.special_requests !== undefined
    const normalizedSpecialRequests = reservationData.special_requests?.trim() || null
    const { data: existingReservation, error: existingReservationError } = await supabase
      .from("reservations")
      .select(`
        *,
        restaurants (id, name),
        reservation_areas (id, name)
      `)
      .eq("id", id)
      .single()

    if (existingReservationError || !existingReservation) {
      return { success: false, message: existingReservationError?.message || "Reservation not found" }
    }

    const currentScope = await coerceRestaurantFilter(existingReservation.restaurant_id)
    if (currentScope.type === "deny") {
      return { success: false, message: "Forbidden" }
    }
    if (!scopeContainsRestaurant(currentScope, existingReservation.restaurant_id)) {
      return { success: false, message: "Forbidden" }
    }

    const targetRestaurantId = reservationData.restaurant_id ?? existingReservation.restaurant_id
    const targetScope = await coerceRestaurantFilter(targetRestaurantId)
    if (targetScope.type === "deny") {
      return { success: false, message: "Forbidden" }
    }
    if (!scopeContainsRestaurant(targetScope, targetRestaurantId)) {
      return { success: false, message: "Forbidden" }
    }
    if (
      reservationData.reservation_area_id &&
      !(await reservationAreaBelongsToRestaurant(
        supabase,
        reservationData.reservation_area_id,
        targetRestaurantId,
      ))
    ) {
      return { success: false, message: "Reservation area does not belong to this restaurant" }
    }

    const { data, error } = await supabase
      .from("reservations")
      .update({
        ...reservationData,
        ...(shouldSyncNotes ? { notes: normalizedSpecialRequests } : {}),
        reservation_area_id: reservationData.reservation_area_id === "" || reservationData.reservation_area_id === undefined
          ? null
          : reservationData.reservation_area_id,
      })
      .eq("id", id)
      .select(`
        *,
        restaurants (id, name),
        reservation_areas (id, name)
      `)
      .single()

    if (error) {
      console.error("Error updating reservation:", error)
      return { success: false, message: error.message }
    }

    const updateSummary = buildReservationUpdateSummary(existingReservation, data, {
      updatedByUserId: access?.userId ?? null,
      source: "staff",
    })
    let updatedReservation = data

    if (updateSummary) {
      const { data: summaryData, error: summaryError } = await supabase
        .from("reservations")
        .update({
          last_update_summary: updateSummary,
          last_updated_by_user_id: access?.userId ?? null,
        })
        .eq("id", id)
        .select(`
          *,
          restaurants (id, name),
          reservation_areas (id, name)
        `)
        .single()

      if (summaryError) {
        console.error("Error saving reservation update summary:", summaryError)
        updatedReservation = { ...data, last_update_summary: updateSummary, last_updated_by_user_id: access?.userId ?? null }
      } else {
        updatedReservation = summaryData
      }
    }

    revalidatePath("/manage/reservations")

    return { success: true, data: await attachBookedByEmail(supabase, updatedReservation), message: "Reservation updated successfully" }
  } catch (error) {
    console.error("Error in updateReservation:", error)
    return { success: false, message: "An unexpected error occurred" }
  }
}

export async function deleteReservation(id: string) {
  try {
    const supabase = createServiceRoleClient()
    const access = await getCurrentUserAccess()
    if (!canWrite(access)) {
      return { success: false, message: "Forbidden" }
    }

    // Fetch to check scope
    const { data: reservation, error: fetchError } = await supabase
      .from("reservations")
      .select("id, restaurant_id")
      .eq("id", id)
      .single()
    if (fetchError) {
      console.error("Error fetching reservation for delete:", fetchError)
      return { success: false, message: fetchError.message }
    }
    const scope = await coerceRestaurantFilter(reservation?.restaurant_id)
    if (scope.type === "deny") {
      return { success: false, message: "Forbidden" }
    }
    if (!scopeContainsRestaurant(scope, reservation?.restaurant_id)) {
      return { success: false, message: "Forbidden" }
    }

    const { error } = await supabase
      .from("reservations")
      .delete()
      .eq("id", id)

    if (error) {
      console.error("Error deleting reservation:", error)
      return { success: false, message: error.message }
    }

    revalidatePath("/manage/reservations")
    return { success: true, id, message: "Reservation deleted successfully" }
  } catch (error) {
    console.error("Error in deleteReservation:", error)
    return { success: false, message: "An unexpected error occurred" }
  }
}

export async function getRestaurants() {
  try {
    // Enforce restaurant scope
    const allowed = await getUserRestaurantIds()

    if (Array.isArray(allowed) && allowed.length === 0) {
      return { success: true, data: [] }
    }

    const { data, error } = await fetchManagedRestaurants(allowed)

    if (error) {
      console.error("Error fetching restaurants:", error)
      return { success: false, message: error.message, data: [] }
    }

    const workspaceId = data?.find((restaurant) => restaurant.workspace_id)?.workspace_id || null
    const restaurantPlanState = workspaceId ? await getWorkspaceRestaurantPlanState(workspaceId) : null
    const restaurants = await Promise.all((data || []).map(async (restaurant) => ({
      ...restaurant,
      logo_url: getSafeRestaurantAssetUrl(restaurant.logo_url),
      primary_image_url: getSafeRestaurantAssetUrl(restaurant.primary_image_url),
      media: Array.isArray(restaurant.media)
        ? restaurant.media.map((media: { media_url?: string | null; [key: string]: unknown }) => ({
            ...media,
            media_url: getSafeRestaurantAssetUrl(media.media_url, GENERIC_RESTAURANT_MEDIA_FALLBACK) || GENERIC_RESTAURANT_MEDIA_FALLBACK,
          }))
        : restaurant.media,
      publicUrl: await getRestaurantPublicUrl({ id: restaurant.id, slug: restaurant.slug, workspaceId: restaurant.workspace_id }),
      planAccess: restaurantPlanState
        ? {
            isLive: restaurantPlanState.liveRestaurantIds.includes(restaurant.id),
            scheduledForOffline: restaurantPlanState.affectedRestaurantIds.includes(restaurant.id),
            offlineAt: restaurantPlanState.scheduledPlan?.effectiveAt || null,
            scheduledPlanName: restaurantPlanState.scheduledPlan?.name || null,
          }
        : null,
    })))
    return { success: true, data: restaurants }
  } catch (error) {
    console.error("Error in getRestaurants:", error)
    return { success: false, message: "An unexpected error occurred", data: [] }
  }
}

export async function getRestaurantOptions() {
  try {
    const allowed = await getUserRestaurantIds()
    if (Array.isArray(allowed) && allowed.length === 0) return { success: true, data: [] }

    let query = createServiceRoleClient()
      .from("restaurants")
      .select("id, name, meal_only_reservations, workspace_id")
      .order("name", { ascending: true })
    if (Array.isArray(allowed)) query = query.in("id", allowed)

    const { data, error } = await query
    if (error) return { success: false, message: error.message, data: [] }
    const workspaceIds = Array.from(new Set((data || []).map((restaurant) => restaurant.workspace_id).filter((id): id is string => Boolean(id))))
    const planStates = new Map<string, Awaited<ReturnType<typeof getWorkspaceRestaurantPlanState>>>()
    await Promise.all(workspaceIds.map(async (workspaceId) => {
      try {
        planStates.set(workspaceId, await getWorkspaceRestaurantPlanState(workspaceId))
      } catch (planError) {
        console.error("Could not resolve restaurant options plan access:", planError)
      }
    }))
    const availableRestaurants = (data || []).filter((restaurant) => {
      if (!restaurant.workspace_id) return true
      return planStates.get(restaurant.workspace_id)?.liveRestaurantIds.includes(restaurant.id) ?? false
    })
    return { success: true, data: availableRestaurants }
  } catch (error) {
    console.error("Error fetching restaurant options:", error)
    return { success: false, message: "An unexpected error occurred", data: [] }
  }
}

// Public function to get all restaurants for the main page (no authentication required)
export async function getPublicRestaurants() {
  try {
    const { data, error } = await fetchPublicRestaurants()

    if (error) {
      console.error("Error fetching public restaurants:", error)
      return { success: false, message: error instanceof Error ? error.message : "An unexpected error occurred", data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("Error in getPublicRestaurants:", error)
    return { success: false, message: "An unexpected error occurred", data: [] }
  }
}

export async function updateRestaurantProfile(id: string, input: RestaurantProfileInput) {
  try {
    const supabase = createServiceRoleClient()
    await requireRestaurantManagementAccess(id)

    const { data: currentRestaurant, error: currentError } = await supabase
      .from("restaurants")
      .select("id, slug")
      .eq("id", id)
      .maybeSingle()

    if (currentError || !currentRestaurant) {
      return { success: false, message: "Restaurant not found." }
    }

    const name = input.name.trim()
    if (!name) return { success: false, message: "Restaurant name is required." }

    const slug = (input.slug?.trim().toLowerCase() || slugifyRestaurantName(name)).trim()
    const slugError = validateRestaurantSlug(slug, currentRestaurant.slug)
    if (slugError) return { success: false, message: slugError }

    for (const [value, label] of [
      [input.menu_url, "Menu URL"],
      [input.location_url, "Location URL"],
      [input.events_url, "Events URL"],
    ] as const) {
      const urlError = validateOptionalPublicUrl(value, label)
      if (urlError) return { success: false, message: urlError }
    }

    const socialLinksError = validateSocialLinks(input.social_links)
    if (socialLinksError) return { success: false, message: socialLinksError }
    const socialLinks = normalizeSocialLinks(input.social_links)
    const profileVisibility = normalizeProfileVisibility(input.profile_visibility)
    const officialWebsiteUrl = input.official_website_url?.trim() ? normalizeOfficialWebsiteUrl(input.official_website_url) : null
    if (input.official_website_url?.trim() && !officialWebsiteUrl) return { success: false, message: "Official website must be a valid http(s) URL." }
    if ((input.latitude == null) !== (input.longitude == null)) return { success: false, message: "Latitude and longitude must be provided together." }
    if (input.latitude != null && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)) return { success: false, message: "Latitude must be between -90 and 90." }
    if (input.longitude != null && (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180)) return { success: false, message: "Longitude must be between -180 and 180." }

    const location = input.location?.trim() || ""
    const locationUrl = input.location_url?.trim() || (
      /^https?:\/\//i.test(location) && !validateOptionalPublicUrl(location, "Location")
        ? location
        : ""
    )

    const { data: slugConflict, error: slugConflictError } = await supabase
      .from("restaurants")
      .select("id")
      .eq("slug", slug)
      .neq("id", id)
      .maybeSingle()

    if (slugConflictError) {
      console.error("Error checking restaurant slug:", slugConflictError)
      return { success: false, message: "Could not validate the public slug." }
    }
    if (slugConflict) {
      let suggestedSlug: string
      try {
        suggestedSlug = await findAvailableRestaurantSlug(supabase, slug, id)
      } catch (error) {
        console.error("Error suggesting an available restaurant slug:", error)
        return { success: false, message: "That public address is already in use. Choose another address and try again." }
      }
      return {
        success: false,
        code: "SLUG_CONFLICT" as const,
        message: `That public address is already in use. Try “${suggestedSlug}” instead. Your other changes are still here.`,
        suggestedSlug,
      }
    }

    const { error } = await supabase
      .from("restaurants")
      .update({
        name,
        slug,
        logo_url: input.logo_url?.trim() || null,
        primary_image_url: input.primary_image_url?.trim() || null,
        description: input.description?.trim() || null,
        cuisine: input.cuisine?.trim() || null,
        atmosphere: input.atmosphere?.trim() || null,
        hours: input.hours?.trim() || null,
        location: location || null,
        phone: input.phone?.trim() || null,
        whatsapp: input.whatsapp?.trim() || null,
        menu_url: input.menu_url?.trim() || null,
        location_url: locationUrl || null,
        events_url: input.events_url?.trim() || null,
        social_links: socialLinks,
        profile_visibility: profileVisibility,
        timezone: input.timezone?.trim() || "UTC",
        language: input.language?.trim() || "en",
        address_line1: input.address_line1?.trim() || null,
        address_line2: input.address_line2?.trim() || null,
        address_locality: input.address_locality?.trim() || null,
        address_region: input.address_region?.trim() || null,
        address_postal_code: input.address_postal_code?.trim() || null,
        address_country: input.address_country?.trim() || null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        official_website_url: officialWebsiteUrl,
        status: input.status === "unpublished" ? "unpublished" : "published",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)

    if (error) {
      const databaseError = error as { code?: string; message?: string; details?: string | null; hint?: string | null }
      console.error("Error updating restaurant profile:", {
        id,
        code: databaseError.code,
        message: databaseError.message,
        details: databaseError.details,
        hint: databaseError.hint,
      })
      if (databaseError.code === "42703" && /social_links/i.test(databaseError.message || "")) {
        return { success: false, message: "Restaurant social links are not enabled yet. Apply the social links database migration, then try again." }
      }
      return { success: false, message: "Failed to save restaurant profile. Please try again." }
    }

    revalidatePath("/")
    revalidatePath(`/r/${slug}`)
    revalidatePath(`/manage/restaurants/${id}/profile`)
    revalidatePath("/manage")
    return { success: true, message: "Restaurant profile updated." }
  } catch (error) {
    console.error("Error updating restaurant profile:", error)
    return { success: false, message: "You do not have permission to update this restaurant profile." }
  }
}

export async function createRestaurant(data: {
  name: string;
  slug?: string;
  workspaceId?: string;
  description?: string;
  cuisine?: string;
  location?: string;
  phone?: string;
  hours?: string;
  atmosphere?: string;
  media_type?: string;
  media_url?: string;
  // Reservation settings
  reservation_enabled?: boolean;
  allowed_days_of_week?: number[];
  opening_time?: string;
  closing_time?: string;
  time_slot_duration?: number;
  advance_booking_days?: number;
  min_advance_hours?: number;
  max_party_size?: number;
  min_party_size?: number;
  reservation_start_date?: string;
  reservation_blocked_intervals?: {
    date: string;
    start_time: string;
    end_time: string;
    message?: string;
  }[];
  reservation_notices?: ReservationNoticeInput[];
  meal_only_reservations?: boolean;
  address_line1?: string | null;
  address_line2?: string | null;
  address_locality?: string | null;
  address_region?: string | null;
  address_postal_code?: string | null;
  address_country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  official_website_url?: string | null;
}) {
  try {
    const supabase = createServiceRoleClient()
    const authorization = await requireWorkspaceCreationAccess(data.workspaceId)

    if (authorization.workspaceId) {
      try {
        await assertWithinLimit(authorization.workspaceId, "restaurants")
      } catch (error) {
        if (error instanceof EntitlementError && error.code === "LIMIT_REACHED") {
          return { success: false, message: "Restaurant limit reached for the current plan." }
        }
        throw error
      }
    }

    const name = data.name.trim()
    if (!name) return { success: false, message: "Restaurant name is required." }
    const officialWebsiteUrl = data.official_website_url?.trim() ? normalizeOfficialWebsiteUrl(data.official_website_url) : null
    if (data.official_website_url?.trim() && !officialWebsiteUrl) return { success: false, message: "Official website must be a valid http(s) URL." }
    if ((data.latitude == null) !== (data.longitude == null)) return { success: false, message: "Latitude and longitude must be provided together." }
    if (data.latitude != null && (!Number.isFinite(data.latitude) || data.latitude < -90 || data.latitude > 90)) return { success: false, message: "Latitude must be between -90 and 90." }
    if (data.longitude != null && (!Number.isFinite(data.longitude) || data.longitude < -180 || data.longitude > 180)) return { success: false, message: "Longitude must be between -180 and 180." }

    const explicitSlug = Boolean(data.slug?.trim())
    const baseSlug = (data.slug?.trim().toLowerCase() || slugifyRestaurantName(name)).trim()
    let slug = baseSlug
    if (!explicitSlug && RESERVED_RESTAURANT_SLUGS.has(slug)) slug = `restaurant-${slug}`

    const slugError = validateRestaurantSlug(slug)
    if (slugError) return { success: false, message: slugError }

    const shouldUseExplicitSlug = explicitSlug || RESERVED_RESTAURANT_SLUGS.has(slug)
    let provisioned: Awaited<ReturnType<typeof provisionRestaurantWorkspace>>
    try {
      provisioned = await provisionRestaurantWorkspace({
        restaurantName: name,
        workspaceId: authorization.workspaceId,
        ownerUserId: authorization.workspaceId ? null : authorization.access.userId,
        restaurantSlug: shouldUseExplicitSlug ? slug : null,
        restaurantStatus: "unpublished",
        ownershipStatus: "claimed",
        source: "self_service",
        description: data.description,
        cuisine: data.cuisine,
        location: data.location,
        phone: data.phone,
        hours: data.hours,
        atmosphere: data.atmosphere,
        media_type: data.media_type === "video" ? "video" : data.media_type === "slideshow" ? "slideshow" : null,
        reservation_enabled: data.reservation_enabled,
        allowed_days_of_week: data.allowed_days_of_week,
        opening_time: data.opening_time,
        closing_time: data.closing_time,
        time_slot_duration: data.time_slot_duration,
        advance_booking_days: data.advance_booking_days,
        min_advance_hours: data.min_advance_hours,
        max_party_size: data.max_party_size,
        min_party_size: data.min_party_size,
        reservation_start_date: data.reservation_start_date === undefined ? null : data.reservation_start_date || null,
        reservation_blocked_intervals: data.reservation_blocked_intervals ?? [],
        reservation_notices: data.reservation_notices ?? [],
        meal_only_reservations: data.meal_only_reservations,
        officialWebsiteUrl,
        addressLine1: data.address_line1,
        addressLine2: data.address_line2,
        addressLocality: data.address_locality,
        addressRegion: data.address_region,
        addressPostalCode: data.address_postal_code,
        addressCountry: data.address_country,
        latitude: data.latitude,
        longitude: data.longitude,
      })
    } catch (error) {
      console.error("Error creating restaurant:", error)
      const message = error instanceof Error ? error.message : "Failed to create restaurant"
      if (message.includes("RESTAURANT_LIMIT_REACHED")) return { success: false, message: "Restaurant limit reached for the current plan." }
      if (message.includes("SLUG_CONFLICT")) {
        let suggestedSlug: string | undefined
        try { suggestedSlug = await findAvailableRestaurantSlug(supabase, slug) } catch (suggestionError) { console.error("Error suggesting an available restaurant slug after a race:", suggestionError) }
        return {
          success: false,
          code: "SLUG_CONFLICT" as const,
          message: suggestedSlug
            ? `That public address was just taken. Try “${suggestedSlug}” instead. Your entered details are still here.`
            : "That public address was just taken. Choose another address and try again. Your entered details are still here.",
          ...(suggestedSlug ? { suggestedSlug } : {}),
        }
      }
      if (message.includes("restaurants_name_key")) return { success: false, message: "That restaurant name is already in use. Try a slightly different display name." }
      return { success: false, message: "Failed to create restaurant" }
    }

    const { data: restaurant, error } = await supabase.from("restaurants").select().eq("id", provisioned.restaurant_id).single()
    if (error || !restaurant) return { success: false, message: "Restaurant was created but could not be loaded." }
    const slugWasAdjusted = provisioned.restaurant_slug !== slug
    slug = provisioned.restaurant_slug

    // Add media if provided
    if (data.media_url && restaurant) {
      const { error: mediaError } = await supabase
        .from("restaurant_media")
        .insert({
          restaurant_id: restaurant.id,
          media_url: data.media_url,
          media_order: 1,
        })

      if (mediaError) {
        console.error("Error adding restaurant media:", mediaError)
      }
    }

    revalidatePath("/manage/restaurants")
    revalidatePath("/manage")
    return {
      success: true,
      message: slugWasAdjusted
        ? `Restaurant created successfully. The public address was already in use, so we used “${slug}”.`
        : "Restaurant created successfully",
      data: restaurant,
    }
  } catch (error) {
    console.error("Error creating restaurant:", error)
    return { success: false, message: "Failed to create restaurant" }
  }
}

export async function getRestaurantCreationAccess(workspaceId?: string) {
  try {
    const authorization = await requireWorkspaceCreationAccess(workspaceId)
    if (!authorization.workspaceId) {
      return {
        success: true,
        data: {
          canCreate: true,
          planKey: "platform",
          planName: "Platform",
          restaurantCount: 0,
          restaurantLimit: null,
          multiRestaurant: true,
          reason: null,
        },
      }
    }

    const [entitlements, usage] = await Promise.all([
      getWorkspaceEntitlements(authorization.workspaceId),
      getWorkspaceUsage(authorization.workspaceId),
    ])
    const reason = restaurantCreationReason(usage.restaurants, entitlements.limits.restaurants)

    return {
      success: true,
      data: {
        canCreate: !reason,
        planKey: entitlements.planKey,
        planName: entitlements.planName,
        restaurantCount: usage.restaurants,
        restaurantLimit: entitlements.limits.restaurants,
        multiRestaurant: entitlements.features.multiRestaurant,
        reason,
      },
    }
  } catch (error) {
    console.error("Could not check restaurant creation access:", error)
    return { success: false, message: "Restaurant creation access could not be checked." }
  }
}

export async function updateRestaurant(id: string, data: {
  name?: string;
  description?: string;
  cuisine?: string;
  location?: string;
  phone?: string;
  hours?: string;
  atmosphere?: string;
  media_type?: string;
  media_url?: string;
  // Reservation settings
  reservation_enabled?: boolean;
  allowed_days_of_week?: number[];
  opening_time?: string;
  closing_time?: string;
  time_slot_duration?: number;
  advance_booking_days?: number;
  min_advance_hours?: number;
  max_party_size?: number;
  min_party_size?: number;
  reservation_start_date?: string;
  reservation_blocked_intervals?: {
    date: string;
    start_time: string;
    end_time: string;
    message?: string;
  }[];
  reservation_notices?: ReservationNoticeInput[];
  meal_only_reservations?: boolean;
  address_line1?: string | null;
  address_line2?: string | null;
  address_locality?: string | null;
  address_region?: string | null;
  address_postal_code?: string | null;
  address_country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  official_website_url?: string | null;
}) {
  try {
    const supabase = createServiceRoleClient()
    await requireRestaurantManagementAccess(id)

    if (data.reservation_enabled === true) {
      const { data: restaurant, error: restaurantError } = await supabase
        .from("restaurants")
        .select("workspace_id")
        .eq("id", id)
        .maybeSingle()
      if (restaurantError || !restaurant) return { success: false, message: "Restaurant not found" }
      if (restaurant.workspace_id && !(await isRestaurantWithinWorkspacePlanLimit(restaurant.workspace_id, id))) {
        return { success: false, message: "This restaurant is offline because of the current plan limit." }
      }
    }

    const officialWebsiteUrl = data.official_website_url?.trim() ? normalizeOfficialWebsiteUrl(data.official_website_url) : null
    if (data.official_website_url?.trim() && !officialWebsiteUrl) return { success: false, message: "Official website must be a valid http(s) URL." }
    if ((data.latitude == null) !== (data.longitude == null)) return { success: false, message: "Latitude and longitude must be provided together." }
    if (data.latitude != null && (!Number.isFinite(data.latitude) || data.latitude < -90 || data.latitude > 90)) return { success: false, message: "Latitude must be between -90 and 90." }
    if (data.longitude != null && (!Number.isFinite(data.longitude) || data.longitude < -180 || data.longitude > 180)) return { success: false, message: "Longitude must be between -180 and 180." }

    const { error } = await supabase
      .from("restaurants")
      .update({
        name: data.name,
        description: data.description,
        cuisine: data.cuisine,
        location: data.location,
        phone: data.phone,
        hours: data.hours,
        atmosphere: data.atmosphere,
        media_type: data.media_type,
        // Reservation settings
        reservation_enabled: data.reservation_enabled,
        allowed_days_of_week: data.allowed_days_of_week,
        opening_time: data.opening_time,
        closing_time: data.closing_time,
        time_slot_duration: data.time_slot_duration,
        advance_booking_days: data.advance_booking_days,
        min_advance_hours: data.min_advance_hours,
        max_party_size: data.max_party_size,
        min_party_size: data.min_party_size,
        reservation_start_date: data.reservation_start_date === undefined ? undefined : data.reservation_start_date || null,
        reservation_blocked_intervals: data.reservation_blocked_intervals,
        reservation_notices: data.reservation_notices,
        meal_only_reservations: data.meal_only_reservations,
        address_line1: data.address_line1?.trim() || null,
        address_line2: data.address_line2?.trim() || null,
        address_locality: data.address_locality?.trim() || null,
        address_region: data.address_region?.trim() || null,
        address_postal_code: data.address_postal_code?.trim() || null,
        address_country: data.address_country?.trim() || null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        official_website_url: officialWebsiteUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)

    if (error) {
      console.error("Error updating restaurant:", error)
      return { success: false, message: "Failed to update restaurant" }
    }

    // Update media if provided
    if (data.media_url) {
      // First, try to update existing media
      const { data: existingMedia } = await supabase
        .from("restaurant_media")
        .select("id")
        .eq("restaurant_id", id)
        .limit(1)
        .single()

      if (existingMedia) {
        await supabase
          .from("restaurant_media")
          .update({ media_url: data.media_url })
          .eq("id", existingMedia.id)
      } else {
        await supabase
          .from("restaurant_media")
          .insert({
            restaurant_id: id,
            media_url: data.media_url,
            media_order: 1,
          })
      }
    }

    revalidatePath("/manage/restaurants")
    revalidatePath("/manage")
    return { success: true, message: "Restaurant updated successfully" }
  } catch (error) {
    console.error("Error updating restaurant:", error)
    return { success: false, message: "Failed to update restaurant" }
  }
}

export async function deleteRestaurant(id: string) {
  try {
    const supabase = createServiceRoleClient()
    await requireRestaurantManagementAccess(id, ["owner", "admin"])

    const { error } = await supabase
      .from("restaurants")
      .delete()
      .eq("id", id)

    if (error) {
      console.error("Error deleting restaurant:", error)
      return { success: false, message: error.message }
    }

    revalidatePath("/manage/restaurants")
    return { success: true, message: "Restaurant deleted successfully" }
  } catch (error) {
    console.error("Error in deleteRestaurant:", error)
    return { success: false, message: "An unexpected error occurred" }
  }
}
