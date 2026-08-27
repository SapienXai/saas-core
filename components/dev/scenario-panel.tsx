"use client"

import { useActionState } from "react"
import { destroyScenarioAction, seedScenarioAction, type ScenarioPanelState } from "@/app/dev/scenarios/actions.dev"
import { SCENARIO_KEYS, type ScenarioManifest } from "@/lib/dev/scenario-factory"

const initialState: ScenarioPanelState = { success: false, message: "" }

export default function ScenarioPanel() {
  const [seedState, seedAction, seedPending] = useActionState(seedScenarioAction, initialState)
  const [destroyState, destroyAction, destroyPending] = useActionState(destroyScenarioAction, initialState)
  const manifest = seedState.manifest

  return (
    <div className="space-y-6">
      <form action={seedAction} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 shadow-sm">
        <label className="grid gap-1 text-sm font-medium">
          Scenario
          <select name="scenario" defaultValue="free-new" className="h-10 rounded-md border bg-white px-3 font-normal">
            {SCENARIO_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <button type="submit" disabled={seedPending} className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50">
          {seedPending ? "Hazırlanıyor…" : "Scenario seed et"}
        </button>
        {seedState.message ? <p className={seedState.success ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>{seedState.message}</p> : null}
      </form>

      {manifest ? <ManifestCard manifest={manifest} action={destroyAction} pending={destroyPending} state={destroyState} /> : null}
    </div>
  )
}

function ManifestCard({ manifest, action, pending, state }: { manifest: ScenarioManifest; action: (formData: FormData) => void; pending: boolean; state: ScenarioPanelState }) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{manifest.key}</h2>
          <p className="text-xs text-slate-500">runId: {manifest.runId}</p>
        </div>
        <form action={action}>
          <input type="hidden" name="manifest" value={JSON.stringify(manifest)} />
          <button type="submit" disabled={pending} className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50">
            {pending ? "Temizleniyor…" : "Scenario temizle"}
          </button>
        </form>
      </div>
      {state.message ? <p className={state.success ? "mb-3 text-sm text-emerald-700" : "mb-3 text-sm text-rose-700"}>{state.message}</p> : null}
      <pre className="max-h-[32rem] overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(manifest, null, 2)}</pre>
    </section>
  )
}
