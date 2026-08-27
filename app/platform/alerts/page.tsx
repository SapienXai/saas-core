import Link from "next/link"
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleAlert, Info } from "lucide-react"
import { getPlatformAlerts } from "@/lib/platform-admin"
import type { PlatformAlert, PlatformAlertSeverity } from "@/lib/platform-alerts"
import { PlatformAlertFilters } from "@/components/platform/platform-alert-filters"
import { PlatformEmptyState, PlatformPageHeader, PlatformSectionHeader, PlatformSeverityBadge, PlatformSurface } from "@/components/platform/platform-primitives"

export const dynamic = "force-dynamic"

const icons = { critical: CircleAlert, warning: AlertTriangle, info: Info }

function formatDetectedAt(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

export default async function PlatformAlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [alerts, resolvedSearchParams] = await Promise.all([getPlatformAlerts(), searchParams])
  const severity = typeof resolvedSearchParams.severity === "string" ? resolvedSearchParams.severity : "all"
  const type = typeof resolvedSearchParams.type === "string" ? resolvedSearchParams.type : "all"
  const filtered = alerts.filter((alert) => (severity === "all" || alert.severity === severity) && (type === "all" || alert.type === type))
  const counts = { critical: alerts.filter((alert) => alert.severity === "critical").length, warning: alerts.filter((alert) => alert.severity === "warning").length, info: alerts.filter((alert) => alert.severity === "info").length }
  return <div className="space-y-6"><PlatformPageHeader eyebrow="Action center" title="Needs attention" description="Reliable platform conditions that need an operator decision or follow-up." actions={<PlatformAlertFilters />} /><div className="grid grid-cols-3 gap-2 sm:max-w-lg sm:gap-3">{(["critical", "warning", "info"] as const).map((level) => <div key={level} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 sm:px-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{level}</p><p className="mt-1 text-xl font-semibold text-white">{counts[level]}</p></div>)}</div><PlatformSurface className="overflow-hidden"><div className="border-b border-white/10 px-4 py-4 sm:px-5"><PlatformSectionHeader title={`${filtered.length} unresolved ${filtered.length === 1 ? "item" : "items"}`} description="Alerts are calculated from current platform state; no acknowledgement state is fabricated." /></div>{filtered.length === 0 ? <PlatformEmptyState title={alerts.length ? "No alerts match these filters" : "Platform is clear"} description={alerts.length ? "Try a broader severity or type filter." : "No reliable needs-attention conditions were detected."} icon={CheckCircle2} /> : <div className="divide-y divide-white/10">{filtered.map((alert) => <AlertRow key={alert.id} alert={alert} />)}</div>}</PlatformSurface></div>
}

function AlertRow({ alert }: { alert: PlatformAlert }) {
  const Icon = icons[alert.severity]
  return <Link href={alert.href} className="flex min-w-0 items-start gap-3 px-4 py-4 transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 sm:px-5"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-slate-300"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-white">{alert.title}</span><PlatformSeverityBadge severity={alert.severity as PlatformAlertSeverity} /></span><span className="mt-1 block truncate text-xs font-medium text-slate-400">{alert.entityLabel}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{alert.message}</span><span className="mt-2 block text-[11px] text-slate-600">{alert.type} · detected {formatDetectedAt(alert.detectedAt)}</span></span><ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-slate-600" /></Link>
}
