import Link from "next/link"
import type React from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowRight, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"

export type ManageMetricTone = "neutral" | "violet" | "amber" | "green"

const metricToneClasses: Record<ManageMetricTone, string> = {
  neutral: "bg-white dark:bg-white/[0.035]",
  violet: "bg-violet-50/70 dark:bg-violet-500/[0.08]",
  amber: "bg-amber-50/70 dark:bg-amber-500/[0.08]",
  green: "bg-emerald-50/70 dark:bg-emerald-500/[0.08]",
}

export function ManagePage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl space-y-5 pb-8 md:space-y-7", className)}>{children}</div>
}

export function ManagePageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300 sm:text-[11px]">{eyebrow}</p> : null}
        <h1 className="mt-1 text-[1.65rem] font-bold leading-tight tracking-[-0.045em] text-slate-950 dark:text-white sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl line-clamp-2 text-[13px] leading-5 text-slate-600 dark:text-slate-400 sm:mt-1.5 sm:text-sm sm:leading-6">{description}</p> : null}
      </div>
      {actions ? <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&>*]:max-w-full [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div> : null}
    </header>
  )
}

export function ManageMetricGrid({ children, className, wide = false }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4", wide && "xl:grid-cols-5", className)}>{children}</div>
}

export function ManageMetricCard({ label, value, detail, tone = "neutral", icon: Icon, href, className }: { label: string; value: React.ReactNode; detail?: React.ReactNode; tone?: ManageMetricTone; icon?: LucideIcon; href?: string; className?: string }) {
  const content = (
    <div className={cn("flex min-h-[5.9rem] min-w-0 flex-col p-3 sm:min-h-[6.6rem] sm:p-3.5", metricToneClasses[tone], className)}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden="true" /> : null}
      </div>
      <p className="mt-auto truncate text-[1.55rem] font-bold leading-none tracking-tight text-slate-950 dark:text-white sm:text-[1.7rem]">{value}</p>
      {detail ? <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{detail}</p> : null}
    </div>
  )
  const classes = cn("min-w-0 overflow-hidden rounded-xl border border-slate-200/80 shadow-sm transition dark:border-white/10", href && "hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md dark:hover:border-violet-400/30")
  return href ? <Link href={href} className={classes}>{content}</Link> : <div className={classes}>{content}</div>
}

export function ManageUsageMetric({ label, value, limit }: { label: string; value: number | undefined; limit: number | null | undefined }) {
  const configured = limit !== undefined
  const available = typeof value === "number"
  const percent = available && typeof limit === "number" && limit > 0 ? Math.min(100, Math.round(value / limit * 100)) : 0
  const valueLabel = !available ? "—" : !configured ? `${value} / —` : limit === null ? `${value} / Unlimited` : `${value} / ${limit}`
  return <div className="min-w-0 p-3 sm:p-4"><div className="flex items-baseline justify-between gap-2"><p className="truncate text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p><p className="shrink-0 text-lg font-bold tabular-nums text-slate-950 dark:text-white">{valueLabel}</p></div>{available && typeof limit === "number" && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className={cn("h-full rounded-full", percent >= 100 ? "bg-rose-500" : percent >= 80 ? "bg-amber-500" : "bg-violet-600")} style={{ width: `${percent}%` }} /></div>}</div>
}

export function ManageSection({ title, description, action, children, className }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-2.5 flex min-w-0 flex-col gap-2 sm:mb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0"><h2 className="text-base font-bold tracking-tight text-slate-950 dark:text-white sm:text-lg">{title}</h2>{description ? <p className="mt-0.5 max-w-2xl line-clamp-2 text-[12px] leading-5 text-slate-500 dark:text-slate-400 sm:text-[13px]">{description}</p> : null}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function ManageToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-xl border border-slate-200/80 bg-white/80 p-2.5 dark:border-white/10 dark:bg-white/[0.035]", className)}>{children}</div>
}

export function ManageDataView({ desktop, mobile, className }: { desktop: React.ReactNode; mobile: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0", className)}><div className="hidden lg:block">{desktop}</div><div className="lg:hidden">{mobile}</div></div>
}

export function ManageSurface({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.035]", className)}>{children}</section>
}

export function ManageListRow({ icon: Icon, title, subtitle, meta, href, action, children }: { icon?: LucideIcon; title: React.ReactNode; subtitle?: React.ReactNode; meta?: React.ReactNode; href?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  const body = <div className="flex min-w-0 items-center gap-3 px-3.5 py-3 sm:px-4 sm:py-3.5">
    {Icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><Icon className="h-4 w-4" aria-hidden="true" /></span> : null}
    <span className="min-w-0 flex-1"><span className="flex min-w-0 flex-wrap items-center gap-2"><strong className="min-w-0 truncate text-sm font-semibold text-slate-950 dark:text-white">{title}</strong>{meta}</span>{subtitle ? <span className="mt-0.5 block min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</span> : null}{children}</span>
    {action || (href ? <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> : null)}
  </div>
  return href ? <Link href={href} className="group block min-w-0 transition hover:bg-violet-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 dark:hover:bg-violet-500/[0.06]">{body}</Link> : body
}

export function ManageEmptyState({ title = "Nothing here yet", description, icon: Icon = Inbox, action, compact = false }: { title?: string; description?: string; icon?: LucideIcon; action?: React.ReactNode; compact?: boolean }) {
  return <div className={cn("text-center", compact ? "px-4 py-7" : "px-5 py-10")}><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"><Icon className="h-5 w-5" aria-hidden="true" /></span><p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>{description ? <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p> : null}{action ? <div className="mt-4 flex justify-center">{action}</div> : null}</div>
}

export function ManageDisclosure({ title, summary, children, defaultOpen = false }: { title: string; summary?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return <details open={defaultOpen} className="group min-w-0 rounded-xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-white/[0.035]"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-semibold text-slate-900 marker:hidden dark:text-white"><span className="min-w-0 truncate">{title}</span><span className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-400"><span className="hidden sm:inline">{summary}</span><span className="text-violet-600 transition-transform group-open:rotate-90 dark:text-violet-300"><ArrowRight className="h-4 w-4" aria-hidden="true" /></span></span></summary><div className="border-t border-slate-100 p-3.5 dark:border-white/10">{children}</div></details>
}
