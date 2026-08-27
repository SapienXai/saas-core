"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, BarChart3, CalendarDays, CheckCircle2, Clock3, Crown, RefreshCw, Users, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getRestaurantOptions } from "@/app/manage/actions"
import { getReportsData, type ReportPeriod, type ReportsData } from "@/app/manage/reports-actions"
import { useManageContext } from "@/context/manage-context"
import { useLanguage } from "@/context/language-context"
import { getIntlLocale } from "@/i18n"

const PERIODS: ReportPeriod[] = ["day", "week", "month"]
const REPORT_CACHE_TTL_MS = 60 * 1000
const EMPTY_REPORT: ReportsData = {
  range: { start: "", end: "", previousStart: "", previousEnd: "", length: 0 },
  summary: { total: 0, covers: 0, confirmed: 0, cancelled: 0, confirmationRate: 0, cancellationRate: 0, change: 0, comparison: { total: 0, covers: 0, confirmed: 0, cancelled: 0, confirmationRatePoints: 0, cancellationRatePoints: 0 } },
  trend: [], users: [], restaurants: [], areas: [], channels: [], hours: [],
}
function ReportsChartsFallback() {
  return <>
    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.8fr)]"><div className="h-[390px] animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.04]" /><div className="h-[390px] animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.04]" /></section>
    <section className="mt-5"><div className="h-[300px] animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.04]" /></section>
  </>
}
const ReportsCharts = dynamic(() => import("@/components/manage/reports-charts").then((module) => module.ReportsCharts), { ssr: false, loading: () => <ReportsChartsFallback /> })

function reportCacheKey(scope: string, restaurantId: string, period: ReportPeriod, language: string) {
  return `reservevia:reports:v1:${scope}:${restaurantId}:${period}:${language}`
}

function readReportCache(key: string): ReportsData | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { cachedAt: number; data: ReportsData }
    if (!parsed?.data || Date.now() - parsed.cachedAt > REPORT_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return parsed.data
  } catch {
    return null
  }
}

function writeReportCache(key: string, data: ReportsData) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data }))
  } catch {
    // Session storage is an optional fast path.
  }
}

function number(value: number, locale: string) { return new Intl.NumberFormat(locale).format(value) }
function shortDate(value: string, locale: string) { return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)) }
function comparisonLabel(change: number, getTranslation: ReturnType<typeof useLanguage>["getTranslation"], suffix = "%") {
  return `${change > 0 ? "+" : ""}${change}${suffix} ${getTranslation("reports.previousPeriod")}`
}

function MetricCard({ label, value, detail, icon: Icon, tone = "violet" }: { label: string; value: string | number; detail: string; icon: typeof CalendarDays; tone?: "violet" | "blue" | "emerald" | "rose" }) {
  const tones = { violet: "bg-violet-100 text-violet-600", blue: "bg-sky-100 text-sky-600", emerald: "bg-emerald-100 text-emerald-600", rose: "bg-rose-100 text-rose-600" }
  return <Card className="overflow-hidden border-0 bg-white shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10"><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{value}</p></div><span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span></div><p className="mt-3 text-[11px] font-medium text-slate-400 dark:text-slate-500">{detail}</p></CardContent></Card>
}

function RankingCard({ title, subtitle, rows, icon: Icon, showCovers = false, locale, coversLabel, noDataLabel }: { title: string; subtitle: string; rows: { name: string; value: number; covers: number }[]; icon: typeof Crown; showCovers?: boolean; locale: string; coversLabel: string; noDataLabel: string }) {
  const max = rows[0]?.value || 1
  return <Card className="border-0 bg-white shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10"><CardContent className="p-5"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-sm font-bold text-slate-950 dark:text-white">{title}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p></div><span className="rounded-xl bg-violet-50 p-2 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300"><Icon className="h-4 w-4" /></span></div><div className="space-y-4">{rows.length ? rows.map((row, index) => <div key={row.name} className="group"><div className="flex items-center gap-3"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${index === 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400"}`}>{index + 1}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{row.name}</p><div className="shrink-0 text-right"><p className="text-xs font-bold text-slate-950 dark:text-white">{number(row.value, locale)}</p>{showCovers && <p className="mt-0.5 text-[10px] font-medium text-slate-400">{number(row.covers, locale)} {coversLabel}</p>}</div></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-400" style={{ width: `${Math.max((row.value / max) * 100, 6)}%` }} /></div></div></div></div>) : <div className="flex h-36 items-center justify-center text-xs text-slate-400">{noDataLabel}</div>}</div></CardContent></Card>
}

export default function ReportsPage() {
  const { role, user, currentWorkspace } = useManageContext()
  const { currentLang, getTranslation } = useLanguage()
  const locale = getIntlLocale(currentLang)
  const [period, setPeriod] = useState<ReportPeriod>("week")
  const [restaurantId, setRestaurantId] = useState("all")
  const [restaurants, setRestaurants] = useState<{ id: string; name: string }[]>([])
  const [data, setData] = useState<ReportsData | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const cacheScope = user.id && currentWorkspace?.id ? `${user.id}:${currentWorkspace.id}` : ""
  const cacheKey = cacheScope ? reportCacheKey(cacheScope, restaurantId, period, currentLang) : ""

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    const result = await getReportsData(restaurantId, period, currentLang)
    if (result.success && result.data) {
      setData(result.data)
      if (cacheKey) writeReportCache(cacheKey, result.data)
    }
    if (background) setRefreshing(false)
  }, [cacheKey, currentLang, period, restaurantId])

  useEffect(() => {
    const cached = cacheKey ? readReportCache(cacheKey) : null
    if (cached) {
      setData(cached)
      void load(true)
    } else {
      void load(false)
    }
  }, [cacheKey, load])
  useEffect(() => { getRestaurantOptions().then((result) => { if (result.success) setRestaurants((result.data || []).map((item: any) => ({ id: item.id, name: item.name }))) }) }, [])

  const periodLabels: Record<ReportPeriod, string> = { day: getTranslation("reports.today"), week: getTranslation("reports.last7Days"), month: getTranslation("reports.last30Days") }
  const selectedPeriod = periodLabels[period]
  const report = data || EMPTY_REPORT
  const periodDetail = report.range.start ? `${report.range.start.split("-").reverse().join(".")} — ${report.range.end.split("-").reverse().join(".")}` : ""
  const channelData = useMemo(() => report.channels, [report.channels])
  const trendData = useMemo(() => report.trend.map((row) => ({ ...row, label: shortDate(row.date, locale) })), [report.trend, locale])

  const summary = report.summary

  return <div className="mx-auto w-full max-w-[1440px] pb-10">
    <section className="relative overflow-hidden rounded-[28px] bg-[#17142d] px-5 py-6 text-white shadow-2xl shadow-violet-950/20 sm:px-7 sm:py-8 max-[600px]:rounded-[22px] max-[600px]:px-4 max-[600px]:py-4">
      <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-violet-500/35 blur-3xl" /><div className="pointer-events-none absolute bottom-0 left-1/3 h-44 w-64 rounded-full bg-indigo-400/20 blur-3xl" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between max-[600px]:gap-4"><div><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-violet-200 max-[600px]:mb-2 max-[600px]:text-[10px]"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 max-[600px]:h-5 max-[600px]:w-5 max-[600px]:rounded-md"><BarChart3 className="h-3.5 w-3.5 max-[600px]:h-3 max-[600px]:w-3" /></span> {getTranslation("reports.businessIntelligence")}</div><h1 className="text-3xl font-bold tracking-tight sm:text-4xl max-[600px]:text-2xl">{getTranslation("reports.title")}</h1><p className="mt-2 max-w-xl text-sm leading-6 text-indigo-100/75 max-[600px]:hidden">{getTranslation("reports.description")}</p></div><div className="flex flex-wrap items-center gap-2 max-[600px]:gap-1.5"><Select value={period} onValueChange={(value) => setPeriod(value as ReportPeriod)}><SelectTrigger className="h-10 w-32 border-white/15 bg-white/10 text-sm font-semibold text-white hover:bg-white/15 max-[600px]:h-9 max-[600px]:w-[7.25rem] max-[600px]:text-xs"><SelectValue /></SelectTrigger><SelectContent>{PERIODS.map((value) => <SelectItem key={value} value={value}>{periodLabels[value]}</SelectItem>)}</SelectContent></Select><Select value={restaurantId} onValueChange={setRestaurantId}><SelectTrigger className="h-10 w-44 border-white/15 bg-white/10 text-sm font-semibold text-white hover:bg-white/15 max-[600px]:h-9 max-[600px]:min-w-0 max-[600px]:flex-1 max-[600px]:text-xs"><SelectValue placeholder={getTranslation("reports.allBranches")} /></SelectTrigger><SelectContent>{role !== "staff" && <SelectItem value="all">{getTranslation("reports.allBranches")}</SelectItem>}{restaurants.map((restaurant) => <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>)}</SelectContent></Select><Button size="icon" variant="ghost" onClick={() => void load()} loading={refreshing} className="h-10 w-10 rounded-xl bg-white/10 text-white hover:bg-white/20 max-[600px]:h-9 max-[600px]:w-9 max-[600px]:rounded-lg" aria-label={getTranslation("reports.refresh")}>{!refreshing && <RefreshCw className="h-4 w-4 max-[600px]:h-3.5 max-[600px]:w-3.5" />}</Button></div></div>
      <div className="relative mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-indigo-100/65 max-[600px]:mt-4 max-[600px]:gap-x-3 max-[600px]:gap-y-1.5 max-[600px]:text-[11px]"><span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-emerald-300" /> {getTranslation("reports.liveData")}</span><span>{selectedPeriod} · {periodDetail}</span><span className="flex items-center gap-1.5 max-[600px]:hidden"><Clock3 className="h-3.5 w-3.5" /> {getTranslation("reports.updatesInRealTime")}</span></div>
    </section>

    <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><MetricCard label={getTranslation("reports.totalReservations")} value={number(summary.total, locale)} detail={comparisonLabel(summary.comparison.total, getTranslation)} icon={CalendarDays} /><MetricCard label={getTranslation("reports.totalCovers")} value={number(summary.covers, locale)} detail={comparisonLabel(summary.comparison.covers, getTranslation)} icon={Users} tone="blue" /><MetricCard label={getTranslation("reports.confirmationRate")} value={`%${summary.confirmationRate}`} detail={comparisonLabel(summary.comparison.confirmationRatePoints, getTranslation, ` ${getTranslation("reports.points")}`)} icon={CheckCircle2} tone="emerald" /><MetricCard label={getTranslation("reports.cancellationRate")} value={`%${summary.cancellationRate}`} detail={comparisonLabel(summary.comparison.cancellationRatePoints, getTranslation, ` ${getTranslation("reports.points")}`)} icon={XCircle} tone="rose" /></section>

    <ReportsCharts trendData={trendData} channelData={channelData} hours={report.hours} change={summary.change} reservationLabel={getTranslation("reports.reservation")} trendTitle={getTranslation("reports.reservationTrend")} trendDescription={getTranslation("reports.trendDescription")} channelsTitle={getTranslation("reports.reservationChannels")} channelsDescription={getTranslation("reports.channelsDescription")} hoursTitle={getTranslation("reports.busyHours")} hoursDescription={getTranslation("reports.hoursDescription")} locale={locale} number={number} />

    <section className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3"><RankingCard title={getTranslation("reports.teamLeadership")} subtitle={getTranslation("reports.mostReservations")} rows={report.users} icon={Crown} locale={locale} coversLabel={getTranslation("reports.covers")} noDataLabel={getTranslation("reports.noData")} /><RankingCard title={getTranslation("reports.branchPerformance")} subtitle={getTranslation("reports.byReservationCount")} rows={report.restaurants} icon={BarChart3} showCovers locale={locale} coversLabel={getTranslation("reports.covers")} noDataLabel={getTranslation("reports.noData")} /><RankingCard title={getTranslation("reports.areaPerformance")} subtitle={getTranslation("reports.mostPopularAreas")} rows={report.areas} icon={Users} locale={locale} coversLabel={getTranslation("reports.covers")} noDataLabel={getTranslation("reports.noData")} /></section>

  </div>
}
