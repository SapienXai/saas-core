export default function DomainsLoading() {
  return <div className="min-h-full" aria-busy="true">
    <div className="mx-auto max-w-4xl space-y-6"><div className="flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-xl bg-violet-100 dark:bg-violet-500/15" /><div><p className="h-3 w-20 animate-pulse rounded bg-slate-200 dark:bg-white/10" /><h1 className="mt-2 h-8 w-32 animate-pulse rounded bg-slate-200 dark:bg-white/10" /><p className="mt-2 h-4 w-72 animate-pulse rounded bg-slate-200 dark:bg-white/10" /></div></div><div className="h-52 animate-pulse rounded-2xl bg-white dark:bg-white/[0.04]" /></div>
  </div>
}
