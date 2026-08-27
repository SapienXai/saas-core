import ScenarioPanel from "@/components/dev/scenario-panel"

export const dynamic = "force-dynamic"

export default function ScenarioPanelPage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Reservevia local tooling</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Scenario factory</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Yalnızca local/dev Supabase üzerinde disposable test kullanıcıları ve tenant verisi üretir. Production build bu sayfayı içermez.
          </p>
        </header>
        <ScenarioPanel />
      </div>
    </main>
  )
}
