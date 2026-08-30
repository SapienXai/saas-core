import Link from "next/link"
import type React from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowLeft, ArrowRight, ArrowUpRight, Inbox, MoreHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type PlatformStatus = "active" | "suspended" | "archived" | "unknown"
export type PlatformSeverity = "critical" | "warning" | "info"

const statusLabels: Record<PlatformStatus, string> = { active: "Active", suspended: "Suspended", archived: "Archived", unknown: "Unknown" }
const statusStyles: Record<PlatformStatus, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  suspended: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300",
  archived: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-400/30 dark:bg-slate-500/10 dark:text-slate-300",
  unknown: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200",
}
const severityStyles: Record<PlatformSeverity, string> = {
  critical: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300",
  warning: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200",
  info: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300",
}

export function PlatformPageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0">{eyebrow ? <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">{eyebrow}</p> : null}<h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">{title}</h2>{description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p> : null}</div>{actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}</header>
}

export function PlatformSectionHeader({ title, description, icon: Icon, action }: { title: string; description?: string; icon?: LucideIcon; action?: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2.5">{Icon ? <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"><Icon className="h-3.5 w-3.5" /></span> : null}<div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-950 dark:text-white">{title}</h3>{description ? <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{description}</p> : null}</div></div>{action ? <div className="shrink-0">{action}</div> : null}</div>
}

export function PlatformStatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = (status || "unknown") as PlatformStatus
  const safeStatus = normalized in statusLabels ? normalized : "unknown"
  return <Badge variant="outline" className={cn("border px-2 py-0.5 text-[11px]", statusStyles[safeStatus])}>{label || statusLabels[safeStatus]}</Badge>
}

export function PlatformSeverityBadge({ severity }: { severity: PlatformSeverity }) { return <Badge variant="outline" className={cn("border px-2 py-0.5 text-[11px] capitalize", severityStyles[severity])}>{severity}</Badge> }
export function PlatformSurface({ className, children }: { className?: string; children: React.ReactNode }) { return <section className={cn("rounded-2xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-white/[0.04]", className)}>{children}</section> }
export function PlatformEmptyState({ title = "Nothing here yet", description, icon: Icon = Inbox }: { title?: string; description?: string; icon?: LucideIcon }) { return <div className="flex flex-col items-center justify-center px-5 py-12 text-center"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-500"><Icon className="h-5 w-5" /></span><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</p>{description ? <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{description}</p> : null}</div> }

export function PlatformEntityCard({ icon: Icon, iconClassName, title, subtitle, badges, facts, href, action, children }: { icon: LucideIcon; iconClassName?: string; title: string; subtitle?: string; badges?: React.ReactNode; facts?: Array<{ label: string; value: React.ReactNode }>; href?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  const content = <div className="flex min-w-0 max-w-full items-start gap-3 p-4"><span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-700 dark:text-violet-200", iconClassName)}><Icon className="h-4.5 w-4.5" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0">{href ? <Link href={href} className="block min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{title}</p>{subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}</Link> : <><p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{title}</p>{subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}</>}</div>{action ? <div className="shrink-0">{action}</div> : null}</div>{badges ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div> : null}{facts?.length ? <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">{facts.map((fact) => <div key={fact.label} className="min-w-0"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{fact.label}</p><p className="mt-0.5 truncate text-xs font-medium text-slate-700 dark:text-slate-300">{fact.value}</p></div>)}</div> : null}{children}</div></div>
  return <div className={cn("w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-white/[0.04]", href && "transition hover:border-violet-300 hover:bg-violet-50/50 dark:hover:border-violet-400/30 dark:hover:bg-white/[0.06]")}>{content}</div>
}
export function PlatformOverflowLink({ href, label = "View details" }: { href: string; label?: string }) { return <Link href={href} aria-label={label} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white"><MoreHorizontal className="h-4 w-4" /></Link> }
export function PlatformViewLink({ href, children = "View" }: { href: string; children?: React.ReactNode }) { return <Link href={href} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-slate-950 dark:border-white/10 dark:text-slate-300 dark:hover:border-violet-400/30 dark:hover:bg-white/[0.06] dark:hover:text-white">{children}<ArrowUpRight className="h-3.5 w-3.5" /></Link> }
export function PlatformPagination({ page, pageSize, total, hasNext, filters }: { page: number; pageSize: number; total: number; hasNext: boolean; filters?: Record<string, string | number | undefined> }) { if (total <= pageSize && page === 1) return null; const makeHref = (nextPage: number) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries({ ...filters, page: nextPage })) { const normalized = String(value ?? ""); if (normalized && normalized !== "all" && normalized !== "1") params.set(key, normalized) } return `?${params.toString()}` }; const from = total === 0 ? 0 : (page - 1) * pageSize + 1; const to = Math.min(page * pageSize, total); return <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-white/10"><p className="text-xs text-slate-500">Showing {from}–{to} of {total}</p><div className="flex items-center gap-2"><Link href={makeHref(Math.max(1, page - 1))} aria-disabled={page === 1} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold dark:border-white/10", page === 1 ? "pointer-events-none opacity-40" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06]")}><ArrowLeft className="h-3.5 w-3.5" />Prev</Link><Link href={makeHref(page + 1)} aria-disabled={!hasNext} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold dark:border-white/10", !hasNext ? "pointer-events-none opacity-40" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06]")}>Next<ArrowRight className="h-3.5 w-3.5" /></Link></div></div> }
export function PlatformTable({ children, className }: { children: React.ReactNode; className?: string }) { return <div className={cn("hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-white/[0.04] lg:block", className)}><div className="overflow-x-auto">{children}</div></div> }
