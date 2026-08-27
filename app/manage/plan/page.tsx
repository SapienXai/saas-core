import Link from "next/link"
import { ArrowLeft, ArrowUpRight, Building2, CalendarDays, Check, CircleAlert, Sparkles, UsersRound } from "lucide-react"
import { getPlanUsage } from "./actions"
import { usageWarningPercent } from "@/lib/entitlements"
import { PaddleBillingActions } from "@/components/manage/paddle-billing-actions"
import { ScheduledPlanChangeBanner } from "@/components/manage/scheduled-plan-change-banner"
import { getServerLanguage, translateServer, translateServerMessage } from "@/lib/server-i18n"
import { PLAN_FEATURE_LABELS } from "@/lib/plan-feature-labels"
import type { TranslationKey } from "@/i18n"
import { formatCurrency, formatDate as formatLocalizedDate, formatNumber } from "@/i18n/format"

export const dynamic = "force-dynamic"

type PlanCatalogEntry = {
  key: string
  name: string
  restaurant_limit: number
  user_limit: number
  reservation_limit: number | null
  history_days: number | null
  features: Record<string, boolean>
}

function formatLimit(value: number | null, language: Awaited<ReturnType<typeof getServerLanguage>>, unlimitedLabel: string) {
  return value === null ? unlimitedLabel : formatNumber(value, language)
}

function formatPrice(cents: number, language: Awaited<ReturnType<typeof getServerLanguage>>) {
  return formatCurrency(cents / 100, language)
}

function formatProviderPrice(amount: string | null | undefined, currency: string | null | undefined, language: Awaited<ReturnType<typeof getServerLanguage>>) {
  if (!amount || !currency || !/^\d+$/.test(amount)) return null
  try {
    const fractionDigits = new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
    return formatNumber(Number(amount) / (10 ** fractionDigits), language, { style: "currency", currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
  } catch {
    return null
  }
}

function UsageMetric({ label, value, limit, language, icon: Icon, unlimitedLabel, warningLabel }: { label: string; value: number; limit: number | null; language: Awaited<ReturnType<typeof getServerLanguage>>; icon: typeof CalendarDays; unlimitedLabel: string; warningLabel: (percent: number) => string }) {
  const percent = usageWarningPercent(value, limit)
  const width = Math.min(percent ?? 0, 100)
  const warningClass = percent !== null && percent >= 100
    ? "bg-rose-500"
    : percent !== null && percent >= 90
      ? "bg-amber-500"
      : "bg-violet-600"

  return (
    <div className="min-w-0 px-5 py-3.5 sm:px-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-bold leading-none tabular-nums text-slate-950 dark:text-white">{formatNumber(value, language)}</p>
      <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
        </div>
      </div>
      {limit !== null ? (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10" aria-label={`${label} usage ${percent}%`}>
            <div className={`h-full rounded-full transition-all ${warningClass}`} style={{ width: `${width}%` }} />
          </div>
          <p className={`mt-1.5 flex items-center justify-between gap-2 text-[10px] font-medium ${percent !== null && percent >= 100 ? "text-rose-600 dark:text-rose-300" : percent !== null && percent >= 80 ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}>
            <span>{formatNumber(value, language)} / {formatLimit(limit, language, unlimitedLabel)}</span>
            {percent !== null && percent >= 80 && <span className="flex items-center gap-1"><CircleAlert className="h-3 w-3" />{warningLabel(percent)}</span>}
          </p>
        </>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
          <Check className="h-3.5 w-3.5" /> {unlimitedLabel}
        </div>
      )}
    </div>
  )
}

function PlanReservationNotice({ usage, limit, language, t }: { usage: number; limit: number | null; language: Awaited<ReturnType<typeof getServerLanguage>>; t: (key: TranslationKey, replacements?: Record<string, string>) => string }) {
  if (limit === null || limit <= 0) return null
  const percent = Math.round((usage / limit) * 100)
  if (percent < 80) return null
  const reached = usage >= limit
  const urgent = percent >= 90
  return (
    <div className={`border-t px-5 py-3.5 sm:px-6 ${reached ? "border-rose-200/80 bg-rose-50/70 dark:border-rose-400/20 dark:bg-rose-500/10" : urgent ? "border-amber-200/80 bg-amber-50/70 dark:border-amber-400/20 dark:bg-amber-500/10" : "border-slate-200/80 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.03]"}`} role="status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${reached ? "text-rose-600 dark:text-rose-300" : "text-amber-600 dark:text-amber-300"}`} aria-hidden="true" />
          <div>
            <p className={`text-xs font-bold ${reached ? "text-rose-900 dark:text-rose-100" : "text-amber-900 dark:text-amber-100"}`}>{reached ? t("manage.common.reservationUsageLimitTitle") : urgent ? t("manage.common.reservationUsageWarningTitle") : t("manage.common.reservationUsageTitle")}</p>
            <p className={`mt-1 text-[11px] ${reached ? "text-rose-800/80 dark:text-rose-200/80" : "text-amber-800/80 dark:text-amber-200/80"}`}>{reached ? t("manage.common.reservationUsageLimitDescription", { used: formatNumber(usage, language), limit: formatNumber(limit, language) }) : t("manage.common.reservationUsageDescription", { used: formatNumber(usage, language), limit: formatNumber(limit, language), percent: String(percent) })}</p>
          </div>
        </div>
        <Link href="#upgrade-plans" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 dark:text-violet-200 dark:hover:bg-violet-500/10">{t("manage.common.viewPlans")}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
      </div>
    </div>
  )
}

export default async function PlanUsagePage() {
  const language = await getServerLanguage()
  const t = (key: TranslationKey, replacements?: Record<string, string>) => translateServer(language, key, replacements)
  const result = await getPlanUsage()
  if (!result.success || !result.data) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-slate-600 dark:text-slate-300">{translateServerMessage(language, result.message || t("manage.planUsage.loadError"))}</div>
  }

  const { workspace, entitlements, usage, billing, plans, configuredPaidPlans, configuredPrices } = result.data
  const catalogPlans = plans as PlanCatalogEntry[]
  const isFree = entitlements.planKey === "free"
  const periodStart = !isFree && billing.provider === "paddle" && billing.currentPeriodStart ? billing.currentPeriodStart : usage.periodStart
  const periodEnd = !isFree && billing.provider === "paddle" && billing.currentPeriodEnd ? billing.currentPeriodEnd : usage.periodEnd
  const currentProviderPrice = configuredPrices.find((price) => price.providerPriceId === billing.currentProviderPriceId)
  const intervalConfiguredPrice = configuredPrices.find((price) => price.planKey === entitlements.planKey && price.interval === billing.billingInterval)
  const currentPrice = currentProviderPrice || intervalConfiguredPrice
  const currentPriceLabel = formatProviderPrice(billing.currentProviderPriceAmount || currentPrice?.amount, currentPrice?.currency || billing.billingCurrency, language) || formatPrice(entitlements.monthlyPriceUsdCents, language)
  const currentPlanEntry = catalogPlans.find((plan) => plan.key === entitlements.planKey)
  const currentPlanFeatures = Object.entries(currentPlanEntry?.features || entitlements.features).filter(([, enabled]) => enabled).slice(0, 4)
  const scheduledPlanEntry = billing.scheduledPlanKey ? catalogPlans.find((plan) => plan.key === billing.scheduledPlanKey) : null
  const formattedPeriodStart = periodStart ? formatLocalizedDate(periodStart, language, { dateStyle: "medium" }) : "—"
  const formattedPeriodEnd = periodEnd ? formatLocalizedDate(periodEnd, language, { dateStyle: "medium" }) : "—"
  const formattedNextBilling = billing.nextBilledAt ? formatLocalizedDate(billing.nextBilledAt, language, { dateStyle: "medium" }) : null
  const periodHeadline = billing.cancelAtPeriodEnd ? t("manage.planUsage.billing.accessUntil") : billing.nextBilledAt ? t("manage.planUsage.billing.nextBilling") : t("manage.planUsage.currentPeriod")
  const periodSupportText = billing.cancelAtPeriodEnd ? t("manage.planUsage.billing.noFurtherPayment") : billing.nextBilledAt ? t("manage.planUsage.billing.renewalDetails") : t("manage.planUsage.usageReset")
  const statusKey: TranslationKey = billing.providerStatus === "past_due"
    ? billing.billingIssueCode === "grace_expired" ? "manage.planUsage.billing.statusGraceExpired" : "manage.planUsage.billing.statusPastDue"
    : billing.providerStatus === "canceled"
      ? "manage.planUsage.billing.statusCanceled"
      : billing.providerStatus === "paused"
        ? "manage.planUsage.billing.statusPaused"
        : isFree
          ? "manage.planUsage.billing.statusFree"
          : "manage.planUsage.billing.statusActive"
  const statusLabel = t(statusKey)

  return (
    <div className="manage-plan-page min-h-full">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200/80 px-3.5 py-3 shadow-sm shadow-slate-900/[0.03] backdrop-blur sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/manage" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300" aria-label={t("manage.planUsage.backDashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">{t("manage.planUsage.kicker")}</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{t("manage.planUsage.title")}</h1>
                <span className="truncate text-xs text-slate-500 dark:text-slate-400">{workspace.name} · {workspace.slug}</span>
              </div>
            </div>
          </div>
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {isFree ? t("manage.planUsage.freePlan") : t("manage.planUsage.activePlan")}
          </span>
        </header>

        <section className="manage-plan-card manage-plan-hero overflow-hidden rounded-[1.75rem] border border-violet-200/80 bg-white shadow-sm dark:border-violet-400/20 dark:bg-white/[0.04]">
          <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
                <Sparkles className="h-3.5 w-3.5" /> {t("manage.planUsage.currentPlan")}
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                <h2 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">{entitlements.planName}</h2>
                <span className="pb-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{currentPriceLabel} {billing.billingInterval === "year" ? t("manage.planUsage.billing.perYear") : t("manage.planUsage.billing.perMonth")}</span>
              </div>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                {isFree ? t("manage.planUsage.essentials") : t("manage.planUsage.growth")}
              </p>
              {billing.cancelAtPeriodEnd && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{t("manage.planUsage.billing.cancelsOn", { plan: entitlements.planName, date: formattedPeriodEnd })}</p>}
              {currentPlanFeatures.length > 0 && <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {currentPlanFeatures.map(([key]) => <div key={key} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"><Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />{PLAN_FEATURE_LABELS[key] ? t(PLAN_FEATURE_LABELS[key]) : key}</div>)}
              </div>}
            </div>
            <div className="manage-plan-period rounded-2xl bg-violet-50 px-4 py-4 dark:bg-violet-500/10">
              <div className="flex items-center justify-between gap-3 lg:justify-end">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-200">{t("manage.planUsage.billing.currentPlanSummary")}</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-white/10 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{statusLabel}</span>
              </div>
              <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-200">{periodHeadline}</p>
              <p className="mt-1 text-lg font-bold text-violet-950 dark:text-violet-100">{formattedNextBilling || formattedPeriodEnd}</p>
              <p className="mt-1 text-[11px] text-violet-700/75 dark:text-violet-200/70">{periodSupportText}</p>
              <div className="mt-4 border-t border-violet-200/70 pt-3 text-[11px] text-violet-800/75 dark:border-white/10 dark:text-violet-200/70"><span className="font-semibold">{formattedPeriodStart}</span> – <span className="font-semibold">{formattedPeriodEnd}</span></div>
            </div>
          </div>
          {billing.scheduledPlanKey && billing.scheduledPlanKey !== entitlements.planKey && scheduledPlanEntry && <ScheduledPlanChangeBanner currentPlanName={entitlements.planName} targetPlanName={scheduledPlanEntry.name} effectiveAt={billing.scheduledPlanAt || billing.scheduledChangeAt || billing.currentPeriodEnd} canManage={billing.canManage} />}
          <div className="grid border-t border-violet-100/80 sm:grid-cols-3 dark:border-white/10">
            <UsageMetric language={language} label={t("manage.planUsage.reservationsPeriod")} value={usage.reservationsCreated} limit={entitlements.limits.reservationsPerPeriod} icon={CalendarDays} unlimitedLabel={t("manage.planUsage.unlimited")} warningLabel={(percent) => percent >= 100 ? t("manage.planUsage.limitReached") : t("manage.planUsage.used", { percent: String(percent) })} />
            <UsageMetric language={language} label={t("manage.planUsage.restaurants")} value={usage.restaurants} limit={entitlements.limits.restaurants} icon={Building2} unlimitedLabel={t("manage.planUsage.unlimited")} warningLabel={(percent) => percent >= 100 ? t("manage.planUsage.limitReached") : t("manage.planUsage.used", { percent: String(percent) })} />
            <UsageMetric language={language} label={t("manage.planUsage.teamMembers")} value={usage.users} limit={entitlements.limits.users} icon={UsersRound} unlimitedLabel={t("manage.planUsage.unlimited")} warningLabel={(percent) => percent >= 100 ? t("manage.planUsage.limitReached") : t("manage.planUsage.used", { percent: String(percent) })} />
          </div>
          <PlanReservationNotice usage={usage.reservationsCreated} limit={entitlements.limits.reservationsPerPeriod} language={language} t={t} />
        </section>

        <PaddleBillingActions
          currentPlan={entitlements.planKey}
          billing={billing}
          plans={plans}
          configuredPaidPlans={configuredPaidPlans}
          configuredPrices={configuredPrices}
        />

      </div>
    </div>
  )
}
