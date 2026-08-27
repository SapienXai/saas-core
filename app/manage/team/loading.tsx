export default function TeamLoading() {
  return <div className="mx-auto max-w-6xl space-y-6" aria-busy="true">
    <div><p className="h-3 w-16 animate-pulse rounded bg-slate-200 dark:bg-white/10" /><h1 className="mt-2 h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-white/10" /><p className="mt-2 h-4 w-72 animate-pulse rounded bg-slate-200 dark:bg-white/10" /></div>
    <div className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.04]" />
    <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.04]" />
    <div className="h-56 animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.04]" />
  </div>
}
