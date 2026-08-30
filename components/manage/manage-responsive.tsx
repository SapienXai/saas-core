import Link from "next/link"
import type React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type ManageMetricTone = "neutral" | "violet" | "amber" | "green"

const metricToneClasses: Record<ManageMetricTone, string> = {
  neutral: "bg-white dark:bg-white/[0.04]",
  violet: "bg-violet-50/75 dark:bg-violet-500/[0.09]",
  amber: "bg-amber-50/75 dark:bg-amber-500/[0.09]",
  green: "bg-emerald-50/75 dark:bg-emerald-500/[0.09]",
}

export function ManagePage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl space-y-6 md:space-y-8", className)}>{children}</div>
}

export function ManagePageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300 sm:text-[11px]">{eyebrow}</p> : null}
        <h1 className="mt-1.5 text-[1.75rem] font-bold leading-tight tracking-[-0.045em] text-slate-950 dark:text-white sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-slate-600 dark:text-slate-400 sm:mt-2 sm:text-sm sm:leading-6">{description}</p> : null}
      </div>
      {actions ? <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&>*]:max-w-full [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div> : null}
    </header>
  )
}

export function ManageMetricGrid({ children, className, wide = false }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4", wide && "xl:grid-cols-5", className)}>{children}</div>
}

export function ManageMetricCard({ label, value, detail, tone = "neutral", icon: Icon, href, className }: { label: string; value: React.ReactNode; detail?: React.ReactNode; tone?: ManageMetricTone; icon?: LucideIcon; href?: string; className?: string }) {
  const content = (
    <div className={cn("flex min-h-[6.8rem] min-w-0 flex-col p-3 sm:min-h-[7.4rem] sm:p-4", metricToneClasses[tone], className)}>
      {Icon ? <Icon className="h-4 w-4 text-violet-600 dark:text-violet-300" aria-hidden="true" /> : null}
      <p className={cn("mt-auto truncate text-[1.65rem] font-bold leading-none tracking-tight text-slate-950 dark:text-white", Icon ? "pt-4" : "pt-1")}>{value}</p>
      <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p>
      {detail ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{detail}</p> : null}
    </div>
  )
  const classes = cn("min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 shadow-sm transition dark:border-white/10", href && "hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md dark:hover:border-violet-400/30")
  return href ? <Link href={href} className={classes}>{content}</Link> : <div className={classes}>{content}</div>
}

export function ManageUsageMetric({ label, value, limit }: { label: string; value: number; limit: number | null }) {
  const percent = limit && limit > 0 ? Math.min(100, Math.round(value / limit * 100)) : 0
  return <div className="min-w-0 p-3 sm:p-4"><div className="flex items-baseline justify-between gap-2"><p className="truncate text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p><p className="shrink-0 text-lg font-bold tabular-nums text-slate-950 dark:text-white">{value}{limit !== null ? ` / ${limit}` : ""}</p></div>{limit !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className={cn("h-full rounded-full", percent >= 100 ? "bg-rose-500" : percent >= 80 ? "bg-amber-500" : "bg-violet-600")} style={{ width: `${percent}%` }} /></div>}</div>
}

export function ManageSection({ title, description, action, children, className }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-3 flex min-w-0 flex-col gap-2 sm:mb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0"><h2 className="text-base font-bold tracking-tight text-slate-950 dark:text-white sm:text-lg">{title}</h2>{description ? <p className="mt-1 max-w-2xl text-[13px] leading-5 text-slate-500 dark:text-slate-400 sm:text-sm">{description}</p> : null}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function ManageToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-2xl border border-slate-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.035]", className)}>{children}</div>
}

export function ManageDataView({ desktop, mobile, className }: { desktop: React.ReactNode; mobile: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0", className)}><div className="hidden lg:block">{desktop}</div><div className="lg:hidden">{mobile}</div></div>
}
