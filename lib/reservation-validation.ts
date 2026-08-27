export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
] as const

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

export interface ReservationBlockedInterval {
  date: string
  start_time: string
  end_time: string
  message?: string
}

export interface ReservationNotice {
  start_date: string
  end_date: string
  title?: string
  message: string
  active?: boolean
  recurring_weekly?: boolean
  recurring_days?: number[]
}

export type ReservationAvailabilitySettings = {
  reservation_enabled?: boolean | null
  opening_time: string | null
  closing_time: string | null
  time_slot_duration: number | null
  advance_booking_days: number | null
  min_advance_hours: number | null
  max_party_size: number | null
  min_party_size: number | null
  allowed_days_of_week: number[] | null
  blocked_dates: string[] | null
  reservation_start_date?: string | null
  reservation_blocked_intervals?: unknown
}

export type ReservationValidationInput = {
  reservationDate: string
  reservationTime: string
  partySize: number
  status?: string | null
}

export type ReservationAvailabilityInput = ReservationValidationInput | {
  reservation_date: string
  reservation_time: string
  party_size: number
}

export type PublicReservationContactInput = {
  customerName: unknown
  customerPhone: unknown
  customerEmail: unknown
  specialRequests?: unknown
  tableNumber?: unknown
  reservationType?: unknown
  lang?: unknown
  restaurantId?: unknown
  reservationAreaId?: unknown
  submissionId?: unknown
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isBoundedString(value: unknown, maxLength: number, options: { required?: boolean } = {}) {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  return (options.required ? trimmed.length > 0 : true) && trimmed.length <= maxLength
}

export function validatePublicReservationContactInput(input: PublicReservationContactInput): string | null {
  if (!isUuid(input.restaurantId)) return "Restaurant information is invalid."
  if (input.reservationAreaId !== undefined && input.reservationAreaId !== null && !isUuid(input.reservationAreaId)) {
    return "Reservation area is invalid."
  }
  if (input.submissionId !== undefined && input.submissionId !== null && !/^[A-Za-z0-9_-]{16,100}$/.test(String(input.submissionId))) {
    return "Reservation submission is invalid."
  }
  if (!isBoundedString(input.customerName, 120, { required: true })) return "Please enter a valid name."
  if (!isBoundedString(input.customerPhone, 40, { required: true })) return "Please enter a valid phone number."
  if (!isBoundedString(input.customerEmail, 254, { required: true }) || !/^\S+@\S+\.\S+$/.test(String(input.customerEmail).trim())) {
    return "Please enter a valid email address."
  }
  if (input.specialRequests !== undefined && input.specialRequests !== null && !isBoundedString(input.specialRequests, 1000)) {
    return "Special requests are too long."
  }
  if (input.tableNumber !== undefined && input.tableNumber !== null && !isBoundedString(input.tableNumber, 40)) {
    return "Table information is invalid."
  }
  if (input.reservationType !== undefined && input.reservationType !== null && !["meal", "drinks"].includes(String(input.reservationType))) {
    return "Reservation type is invalid."
  }
  if (input.lang !== undefined && input.lang !== null && !/^[A-Za-z]{2,8}$/.test(String(input.lang))) {
    return "Language is invalid."
  }
  return null
}

export function isReservationStatus(value: unknown): value is ReservationStatus {
  return typeof value === "string" && RESERVATION_STATUSES.includes(value as ReservationStatus)
}

export function normalizeBlockedIntervals(value: unknown): ReservationBlockedInterval[] {
  if (!Array.isArray(value)) return []

  return value.filter((interval): interval is ReservationBlockedInterval => (
    Boolean(interval) &&
    typeof interval === "object" &&
    typeof (interval as ReservationBlockedInterval).date === "string" &&
    typeof (interval as ReservationBlockedInterval).start_time === "string" &&
    typeof (interval as ReservationBlockedInterval).end_time === "string"
  ))
}

export function normalizeReservationNotices(value: unknown): ReservationNotice[] {
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

export function parseTimeToMinutes(value: string | null | undefined) {
  if (!value) return null
  const [hour, minute = 0] = value.split(":").map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour === 24 && minute === 0) return 24 * 60
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

export function findBlockedIntervalForReservation(
  intervals: ReservationBlockedInterval[],
  reservationDate: string,
  reservationTime: string
) {
  const reservationMinutes = parseTimeToMinutes(reservationTime)
  if (reservationMinutes === null) return null

  return intervals.find((interval) => {
    if (interval.date !== reservationDate) return false
    const startMinutes = parseTimeToMinutes(interval.start_time)
    const endMinutes = parseTimeToMinutes(interval.end_time)
    if (startMinutes === null || endMinutes === null) return false
    return reservationMinutes >= startMinutes && reservationMinutes < endMinutes
  }) || null
}

export function parseReservationDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const [, year, month, day] = match.map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

export function validateReservationInput(input: ReservationValidationInput): string | null {
  if (!parseReservationDate(input.reservationDate) || parseTimeToMinutes(input.reservationTime) === null) {
    return "Please select a valid reservation date and time."
  }

  if (!Number.isInteger(input.partySize) || input.partySize <= 0) {
    return "Party size must be a positive whole number."
  }

  if (input.status !== undefined && input.status !== null && !isReservationStatus(input.status)) {
    return "Reservation status is invalid."
  }

  return null
}

export function validateReservationAvailability(
  params: ReservationAvailabilityInput,
  restaurant: ReservationAvailabilitySettings,
  area: ReservationAvailabilitySettings | null,
  now = new Date()
) {
  const reservationDate = "reservation_date" in params ? params.reservation_date : params.reservationDate
  const reservationTime = "reservation_time" in params ? params.reservation_time : params.reservationTime
  const partySize = "party_size" in params ? params.party_size : params.partySize
  const date = parseReservationDate(reservationDate)
  const timeMinutes = parseTimeToMinutes(reservationTime)
  if (!date || timeMinutes === null) return "Please select a valid reservation date and time."

  if (restaurant.reservation_enabled === false) {
    return "This restaurant is not accepting reservations right now."
  }

  const settings = {
    openingTime: area?.opening_time || restaurant.opening_time || "17:00",
    closingTime: area?.closing_time || restaurant.closing_time || "20:45",
    slotDuration: area?.time_slot_duration ?? restaurant.time_slot_duration ?? 15,
    advanceBookingDays: area?.advance_booking_days ?? restaurant.advance_booking_days ?? 15,
    minAdvanceHours: area?.min_advance_hours ?? restaurant.min_advance_hours ?? 0,
    minPartySize: area?.min_party_size ?? restaurant.min_party_size ?? 1,
    maxPartySize: area?.max_party_size ?? restaurant.max_party_size ?? 8,
    allowedDays: area?.allowed_days_of_week || restaurant.allowed_days_of_week || [1, 2, 3, 4, 5, 6, 7],
    blockedDates: area?.blocked_dates || restaurant.blocked_dates || [],
  }

  const openingMinutes = parseTimeToMinutes(settings.openingTime)
  const closingMinutes = parseTimeToMinutes(settings.closingTime)
  if (
    openingMinutes === null ||
    closingMinutes === null ||
    !Number.isInteger(settings.slotDuration) ||
    settings.slotDuration <= 0
  ) {
    return "This restaurant's reservation settings are invalid."
  }

  if (
    timeMinutes < openingMinutes ||
    timeMinutes > closingMinutes ||
    (timeMinutes - openingMinutes) % settings.slotDuration !== 0
  ) {
    return `Please select a time between ${settings.openingTime} and ${settings.closingTime}.`
  }

  if (partySize < settings.minPartySize || partySize > settings.maxPartySize) {
    return `Party size must be between ${settings.minPartySize} and ${settings.maxPartySize}.`
  }

  const databaseWeekday = date.getDay() === 0 ? 7 : date.getDay()
  if (!settings.allowedDays.includes(databaseWeekday)) {
    return "Reservations are not available on the selected day."
  }

  if (settings.blockedDates.includes(reservationDate)) {
    return "Reservations are not available on the selected date."
  }

  if (restaurant.reservation_start_date && reservationDate < restaurant.reservation_start_date) {
    return `This restaurant accepts reservations starting from ${restaurant.reservation_start_date}.`
  }

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const latestDate = new Date(today)
  latestDate.setDate(today.getDate() + settings.advanceBookingDays - 1)
  if (date < today || date > latestDate) {
    return "The selected date is outside the available booking window."
  }

  const reservationDateTime = new Date(date)
  reservationDateTime.setHours(Math.floor(timeMinutes / 60), timeMinutes % 60, 0, 0)
  const minimumDateTime = new Date(now.getTime() + settings.minAdvanceHours * 60 * 60 * 1000)
  if (reservationDateTime < minimumDateTime) {
    return "The selected time does not meet the minimum advance booking requirement."
  }

  const blockedInterval = findBlockedIntervalForReservation(
    normalizeBlockedIntervals(restaurant.reservation_blocked_intervals),
    reservationDate,
    reservationTime
  )
  if (blockedInterval) {
    return blockedInterval.message || `We are fully booked between ${blockedInterval.start_time} - ${blockedInterval.end_time}.`
  }

  return null
}
