export default function ManageLoading() {
  return <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-busy="true">
    <div className="h-36 animate-pulse rounded-[28px] bg-slate-200/80 dark:bg-white/[0.06]" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/[0.05]" />)}
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.8fr)]">
      <div className="h-80 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/[0.05]" />
      <div className="h-80 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/[0.05]" />
    </div>
  </div>
}
