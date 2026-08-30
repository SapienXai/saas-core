import Link from "next/link"
import type React from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowLeft, ArrowRight, ArrowUpRight, MoreHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ManageEmptyState, ManagePageHeader, ManageSurface } from "@/components/manage/manage-responsive"
import { cn } from "@/lib/utils"

export type PlatformStatus = "active" | "suspended" | "archived" | "unknown"
export type PlatformSeverity = "critical" | "warning" | "info"

const statusLabels: Record<PlatformStatus, string> = { active: "Active", suspended: "Suspended", archived: "Archived", unknown: "Unknown" }
const statusStyles: Record<PlatformStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  suspended: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300",
  archived: "border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300",
  unknown: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300",
}
const severityStyles: Record<PlatformSeverity, string> = {
  critical: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-300",
}

export function PlatformPageHeader(props: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) { return <ManagePageHeader {...props} /> }

export function PlatformSectionHeader({ title, description, icon: Icon, action }: { title: string; description?: string; icon?: LucideIcon; action?: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2.5">{Icon ? <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span> : null}<div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>{description ? <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{description}</p> : null}</div></div>{action ? <div className="shrink-0">{action}</div> : null}</div>
}

export function PlatformStatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = (status || "unknown") as PlatformStatus
  const safeStatus = normalized in statusLabels ? normalized : "unknown"
  return <Badge variant="outline" className={cn("border px-2 py-0.5 text-[11px]", statusStyles[safeStatus])}>{label || statusLabels[safeStatus]}</Badge>
}

export function PlatformSeverityBadge({ severity }: { severity: PlatformSeverity }) { return <Badge variant="outline" className={cn("border px-2 py-0.5 text-[11px] capitalize", severityStyles[severity])}>{severity}</Badge> }
export function PlatformSurface({ className, children }: { className?: string; children: React.ReactNode }) { return <ManageSurface className={className}>{children}</ManageSurface> }
export function PlatformEmptyState({ title = "Nothing here yet", description, icon: Icon = MoreHorizontal }: { title?: string; description?: string; icon?: LucideIcon }) { return <ManageEmptyState title={title} description={description} icon={Icon} /> }

export function PlatformEntityCard({ icon: Icon, iconClassName, title, subtitle, badges, facts, href, action, children }: { icon: LucideIcon; iconClassName?: string; title: string; subtitle?: string; badges?: React.ReactNode; facts?: Array<{ label: string; value: React.ReactNode }>; href?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  const content = <div className="flex min-w-0 items-start gap-3 p-3.5 sm:p-4"><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300", iconClassName)}><Icon className="h-4 w-4" aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0">{href ? <Link href={href} className="block min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"><p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{title}</p>{subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}</Link> : <><p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{title}</p>{subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}</>}</div>{action ? <div className="shrink-0">{action}</div> : null}</div>{badges ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div> : null}{facts?.length ? <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">{facts.map((fact) => <div key={fact.label} className="min-w-0"><p className="text-[10px] uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{fact.label}</p><p className="mt-0.5 truncate text-xs font-medium text-slate-700 dark:text-slate-300">{fact.value}</p></div>)}</div> : null}{children}</div></div>
  return <div className={cn("w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-white/[0.035]", href && "transition hover:border-violet-300 hover:bg-violet-50/50 dark:hover:border-violet-400/30 dark:hover:bg-violet-500/[0.06]")}>{content}</div>
}

export function PlatformOverflowLink({ href, label = "View details" }: { href: string; label?: string }) { return <Link href={href} aria-label={label} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white"><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Link> }
export function PlatformViewLink({ href, children = "View" }: { href: string; children?: React.ReactNode }) { return <Link href={href} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white">{children}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> }

export function PlatformPagination({ page, pageSize, total, hasNext, filters }: { page: number; pageSize: number; total: number; hasNext: boolean; filters?: Record<string, string | number | undefined> }) {
  if (total <= pageSize && page === 1) return null
  const makeHref = (nextPage: number) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries({ ...filters, page: nextPage })) { const normalized = String(value ?? ""); if (normalized && normalized !== "all" && normalized !== "1") params.set(key, normalized) } return `?${params.toString()}` }
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return <div className="flex flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500 dark:text-slate-400">Showing {from}–{to} of {total}</p><div className="flex items-center gap-2"><Link href={makeHref(Math.max(1, page - 1))} aria-disabled={page === 1} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-white/10", page === 1 ? "pointer-events-none opacity-40" : "text-slate-700 hover:bg-violet-50 dark:text-slate-300 dark:hover:bg-white/[0.06]")}><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Prev</Link><Link href={makeHref(page + 1)} aria-disabled={!hasNext} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-white/10", !hasNext ? "pointer-events-none opacity-40" : "text-slate-700 hover:bg-violet-50 dark:text-slate-300 dark:hover:bg-white/[0.06]")}>Next<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /> </Link></div></div>
}

export function PlatformTable({ children, className }: { children: React.ReactNode; className?: string }) { return <div className={cn("hidden overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-white/[0.035] lg:block", className)}><div className="overflow-x-auto">{children}</div></div> }
