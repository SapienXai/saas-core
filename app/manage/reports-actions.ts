"use server"

import { createServiceRoleClient } from "@/lib/supabase"
import { coerceRestaurantFilter } from "@/lib/auth-utils"
import { getHistoryCutoffsForRestaurants, isReservationVisibleInHistory } from "@/lib/entitlements"
import { translate, type SupportedLanguage, type TranslationKey } from "@/i18n"

export type ReportPeriod = "day" | "week" | "month"

export type ReportsData = {
  range: { start: string; end: string; previousStart: string; previousEnd: string; length: number }
  summary: {
    total: number; covers: number; confirmed: number; cancelled: number; confirmationRate: number; cancellationRate: number; change: number
    comparison: { total: number; covers: number; confirmed: number; cancelled: number; confirmationRatePoints: number; cancellationRatePoints: number }
  }
  trend: { date: string; reservations: number; covers: number }[]
  users: { name: string; value: number; covers: number }[]
  restaurants: { name: string; value: number; covers: number }[]
  areas: { name: string; value: number; covers: number }[]
  channels: { name: string; value: number; covers: number }[]
  hours: { hour: string; reservations: number }[]
}

type ReportRow = {
  created_at: string
  reservation_date: string
  reservation_time: string
  status: string | null
  party_size: number | null
  booked_by_user_id: string | null
  booked_by_label: string | null
  booking_source: string | null
  restaurants: { name: string } | { name: string }[] | null
  reservation_areas: { name: string } | { name: string }[] | null
}

type Aggregate = { name: string; value: number; covers: number }

type ReservationSummary = { total: number; covers: number; confirmed: number; cancelled: number; confirmationRate: number; cancellationRate: number }

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function getPeriodRange(period: ReportPeriod) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const length = period === "day" ? 1 : period === "week" ? 7 : 30
  const start = period === "week"
    ? addDays(today, -6)
    : period === "month"
      ? addDays(today, -29)
      : today
  const previousEnd = addDays(start, -1)
  const previousStart = addDays(previousEnd, -(length - 1))
  return { start: dateKey(start), end: dateKey(today), previousStart: dateKey(previousStart), previousEnd: dateKey(previousEnd), length }
}

function getRelationName(value: ReportRow["restaurants"] | ReportRow["reservation_areas"], unassignedLabel: string) {
  return (Array.isArray(value) ? value[0] : value)?.name || unassignedLabel
}

function getCreatedAtRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`)
  const end = addDays(new Date(`${endDate}T00:00:00`), 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

function getReportDate(row: ReportRow, range: ReturnType<typeof getPeriodRange>) {
  if (row.reservation_date >= range.start && row.reservation_date <= range.end) {
    return row.reservation_date
  }

  return dateKey(new Date(row.created_at))
}

function addAggregate(map: Map<string, Aggregate>, name: string, row: ReportRow) {
  const current = map.get(name) || { name, value: 0, covers: 0 }
  current.value += 1
  current.covers += Number(row.party_size || 0)
  map.set(name, current)
}

function ranking(map: Map<string, Aggregate>) {
  return Array.from(map.values()).sort((a, b) => b.value - a.value || b.covers - a.covers).slice(0, 5)
}

async function fetchReportRows(
  supabase: ReturnType<typeof createServiceRoleClient>,
  scope: Awaited<ReturnType<typeof coerceRestaurantFilter>>,
  startDate: string,
  endDate: string,
  select: string
) {
  const pageSize = 1000
  const rows: any[] = []
  const createdAtRange = getCreatedAtRange(startDate, endDate)

  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("reservations")
      .select(select)
      .or(`and(reservation_date.gte.${startDate},reservation_date.lte.${endDate}),and(created_at.gte.${createdAtRange.start},created_at.lt.${createdAtRange.end})`)

    if (scope.type === "one" && scope.id) query = query.eq("restaurant_id", scope.id)
    if (scope.type === "many") query = query.in("restaurant_id", scope.ids)

    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return rows
  }
}

function filterRowsByHistory(rows: any[], cutoffs: Map<string, string | null>) {
  return rows.filter((row) => {
    const cutoff = cutoffs.get(row.restaurant_id)
    return !cutoff || isReservationVisibleInHistory(row.reservation_date, cutoff)
  })
}

export async function getReportsData(restaurantId = "all", period: ReportPeriod = "week", language: SupportedLanguage = "en") {
  try {
    const supabase = createServiceRoleClient()
    const scope = await coerceRestaurantFilter(restaurantId)
    const range = getPeriodRange(period)
    if (scope.type === "deny") return { success: true, data: emptyReport(range) }

    const select = "restaurant_id, created_at, reservation_date, reservation_time, status, party_size, booked_by_user_id, booked_by_label, booking_source, restaurants (name), reservation_areas (name)"
    const [currentRows, previousRows] = await Promise.all([
      fetchReportRows(supabase, scope, range.start, range.end, select),
      fetchReportRows(supabase, scope, range.previousStart, range.previousEnd, "restaurant_id, created_at, reservation_date, status, party_size"),
    ])
    const restaurantIds = scope.type === "one" && scope.id
      ? [scope.id]
      : scope.type === "many"
        ? scope.ids
        : []
    const cutoffs = await getHistoryCutoffsForRestaurants(restaurantIds)
    const rows = filterRowsByHistory(currentRows, cutoffs) as ReportRow[]
    const filteredPreviousRows = filterRowsByHistory(previousRows, cutoffs)

    const userIds = Array.from(new Set(rows.map((row) => row.booked_by_user_id).filter((id): id is string => Boolean(id))))
    const nameMap = new Map<string, string>()
    if (userIds.length) {
      const { data: profiles } = await supabase.from("admin_profiles").select("id, full_name").in("id", userIds)
      for (const profile of profiles || []) if (profile.full_name?.trim()) nameMap.set(profile.id, profile.full_name.trim())
    }

    const daily = new Map<string, { date: string; reservations: number; covers: number }>()
    for (let index = 0; index < range.length; index += 1) {
      const key = dateKey(addDays(new Date(`${range.start}T00:00:00`), index))
      daily.set(key, { date: key, reservations: 0, covers: 0 })
    }
    const byUser = new Map<string, Aggregate>()
    const byRestaurant = new Map<string, Aggregate>()
    const byArea = new Map<string, Aggregate>()
    const byChannel = new Map<string, Aggregate>()
    const byHour = new Map<string, number>()

    for (const row of rows) {
      const dailyPoint = daily.get(getReportDate(row, range))
      if (dailyPoint) {
        dailyPoint.reservations += 1
        dailyPoint.covers += Number(row.party_size || 0)
      }
      const user = row.booked_by_label?.trim() || (row.booked_by_user_id ? nameMap.get(row.booked_by_user_id) : null) || translate(language, "reports.online")
      addAggregate(byUser, user, row)
      addAggregate(byRestaurant, getRelationName(row.restaurants, translate(language, "reports.unassigned")), row)
      addAggregate(byArea, getRelationName(row.reservation_areas, translate(language, "reports.unassigned")), row)
      addAggregate(byChannel, formatBookingSource(row.booking_source, language), row)
      const hour = row.reservation_time?.slice(0, 2) || "00"
      byHour.set(hour, (byHour.get(hour) || 0) + 1)
    }

    const summary = summarizeReservations(rows)
    const previousSummary = summarizeReservations(filteredPreviousRows as Pick<ReportRow, "status" | "party_size">[])
    const comparison = {
      total: percentChange(summary.total, previousSummary.total),
      covers: percentChange(summary.covers, previousSummary.covers),
      confirmed: percentChange(summary.confirmed, previousSummary.confirmed),
      cancelled: percentChange(summary.cancelled, previousSummary.cancelled),
      confirmationRatePoints: summary.confirmationRate - previousSummary.confirmationRate,
      cancellationRatePoints: summary.cancellationRate - previousSummary.cancellationRate,
    }
    return {
      success: true,
      data: {
        range,
        summary: { ...summary, change: comparison.total, comparison },
        trend: Array.from(daily.values()),
        users: ranking(byUser),
        restaurants: ranking(byRestaurant),
        areas: ranking(byArea),
        channels: ranking(byChannel),
        hours: Array.from(byHour.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([hour, reservations]) => ({ hour: `${hour}:00`, reservations })),
      },
    }
  } catch (error) {
    console.error("Error in getReportsData:", error)
    return { success: false, message: translate(language, "reports.loadError") }
  }
}

function formatBookingSource(source: string | null, language: SupportedLanguage) {
  const keys: Record<string, TranslationKey> = {
    online: "manage.reservationForm.bookingSourceOnline",
    phone: "manage.reservationForm.bookingSourcePhone",
    whatsapp: "manage.reservationForm.bookingSourceWhatsapp",
    email: "manage.reservationForm.bookingSourceEmail",
    walk_in: "manage.reservationForm.bookingSourceWalkIn",
    staff: "manage.reservationForm.bookingSourceStaff",
    social_media: "manage.reservationForm.bookingSourceSocial",
    maps: "manage.reservationForm.bookingSourceMaps",
    other: "manage.reservationForm.bookingSourceOther",
  }
  return translate(language, keys[source || "other"] || keys.other)
}

function summarizeReservations(rows: Pick<ReportRow, "status" | "party_size">[]): ReservationSummary {
  const total = rows.length
  const confirmed = rows.filter((row) => row.status === "confirmed").length
  const cancelled = rows.filter((row) => row.status === "cancelled").length
  const covers = rows.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + Number(row.party_size || 0), 0)
  return {
    total,
    covers,
    confirmed,
    cancelled,
    confirmationRate: total ? Math.round((confirmed / total) * 100) : 0,
    cancellationRate: total ? Math.round((cancelled / total) * 100) : 0,
  }
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

function emptyReport(range: ReturnType<typeof getPeriodRange>): ReportsData {
  return {
    range,
    summary: { total: 0, covers: 0, confirmed: 0, cancelled: 0, confirmationRate: 0, cancellationRate: 0, change: 0, comparison: { total: 0, covers: 0, confirmed: 0, cancelled: 0, confirmationRatePoints: 0, cancellationRatePoints: 0 } },
    trend: [], users: [], restaurants: [], areas: [], channels: [], hours: [],
  }
}
