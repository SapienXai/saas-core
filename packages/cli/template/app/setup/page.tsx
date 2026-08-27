import Link from "next/link"
import { ArrowRight, CheckCircle2, Settings2 } from "lucide-react"

export const dynamic = "force-dynamic"

export default function SetupPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950 dark:bg-[#101116] dark:text-white sm:px-6"><div className="mx-auto max-w-3xl"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Settings2 className="h-6 w-6" /></div><p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">Workspace setup</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Finish setting up your workspace</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">Connect your team, review the plan, and configure the workspace experience from the management area.</p><div className="mt-8 grid gap-3 sm:grid-cols-3">{[["Team", "/app/team"], ["Plan", "/app/plan"], ["Settings", "/app/settings"]].map(([label, href]) => <Link key={href} href={href} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 dark:border-white/10 dark:bg-white/[0.04]"><CheckCircle2 className="h-5 w-5 text-emerald-500" /><p className="mt-4 font-bold">{label}</p><span className="mt-2 flex items-center gap-1 text-xs font-semibold text-violet-700 dark:text-violet-300">Open <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></Link>)}</div></div></main>
}
