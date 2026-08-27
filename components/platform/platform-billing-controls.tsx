"use client"

import { useState, useTransition } from "react"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { addSubscriptionOverride, removeSubscriptionOverride, savePlatformPlan } from "@/app/platform/actions"

const FEATURE_KEYS = ["hostedRestaurantPage", "emailNotifications", "removeReserveviaBranding", "customDomain", "basicAnalytics", "csvExport", "guestHistory", "automatedNotifications", "advancedReports", "customPWA", "pushNotifications", "multiRestaurant"]

function label(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())
}

export function PlatformPlanEditor({ plan, canEdit }: { plan: any; canEdit: boolean }) {
  const [name, setName] = useState(plan.name)
  const [price, setPrice] = useState(String(plan.monthly_price_usd_cents))
  const [restaurantLimit, setRestaurantLimit] = useState(String(plan.restaurant_limit))
  const [userLimit, setUserLimit] = useState(String(plan.user_limit))
  const [reservationLimit, setReservationLimit] = useState(plan.reservation_limit === null ? "" : String(plan.reservation_limit))
  const [historyDays, setHistoryDays] = useState(plan.history_days === null ? "" : String(plan.history_days))
  const [features, setFeatures] = useState<Record<string, boolean>>(plan.features || {})
  const [pending, startTransition] = useTransition()

  function submit() {
    const reason = window.prompt(`Reason for updating the ${plan.key} plan:`)
    if (reason === null) return
    startTransition(async () => {
      const result = await savePlatformPlan({
        planKey: plan.key,
        name,
        monthlyPriceUsdCents: Number(price),
        restaurantLimit: Number(restaurantLimit),
        userLimit: Number(userLimit),
        reservationLimit: reservationLimit ? Number(reservationLimit) : null,
        historyDays: historyDays ? Number(historyDays) : null,
        features,
        reason,
      })
      if (result.success) { toast.success(`${plan.name} plan updated`); window.location.reload() } else toast.error("message" in result ? result.message : "Plan update failed")
    })
  }

  return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300">{plan.key}</p><h3 className="mt-2 text-xl font-semibold text-white">{plan.name}</h3></div><button type="button" disabled={!canEdit || pending} onClick={submit} className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40">{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save plan</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-400">Name<input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:opacity-50" /></label><label className="text-xs text-slate-400">Monthly price (cents)<input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} disabled={!canEdit} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:opacity-50" /></label><label className="text-xs text-slate-400">Restaurant limit<input type="number" min="1" value={restaurantLimit} onChange={(event) => setRestaurantLimit(event.target.value)} disabled={!canEdit} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:opacity-50" /></label><label className="text-xs text-slate-400">User limit<input type="number" min="1" value={userLimit} onChange={(event) => setUserLimit(event.target.value)} disabled={!canEdit} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:opacity-50" /></label><label className="text-xs text-slate-400">Reservation limit (empty = unlimited)<input type="number" min="1" value={reservationLimit} onChange={(event) => setReservationLimit(event.target.value)} disabled={!canEdit} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:opacity-50" /></label><label className="text-xs text-slate-400">History days (empty = unlimited)<input type="number" min="1" value={historyDays} onChange={(event) => setHistoryDays(event.target.value)} disabled={!canEdit} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:opacity-50" /></label></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{FEATURE_KEYS.map((key) => <label key={key} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={Boolean(features[key])} onChange={(event) => setFeatures((current) => ({ ...current, [key]: event.target.checked }))} disabled={!canEdit} className="accent-violet-500" />{label(key)}</label>)}</div>{!canEdit && <p className="mt-4 text-xs text-slate-500">Your role can inspect the catalog but cannot edit plan definitions.</p>}</div>
}

export function SubscriptionOverrideForm({ workspaces, plans, canEdit }: { workspaces: Array<{ id: string; name: string; planKey: string }>; plans: Array<{ key: string; name: string }>; canEdit: boolean }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || "")
  const [planKey, setPlanKey] = useState(plans[0]?.key || "free")
  const [effectiveUntil, setEffectiveUntil] = useState("")
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()
  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await addSubscriptionOverride({ workspaceId, planKey, effectiveUntil: effectiveUntil ? new Date(`${effectiveUntil}T23:59:59Z`).toISOString() : undefined, reason })
      if (result.success) { toast.success("Subscription override created"); window.location.reload() } else toast.error("message" in result ? result.message : "Override could not be created")
    })
  }
  return <form onSubmit={submit} className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-5"><h3 className="font-semibold text-white">Create manual override</h3><p className="mt-1 text-xs text-slate-400">This changes effective Reservevia entitlements only. Paddle remains unchanged.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-400">Workspace<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={!canEdit || pending} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50">{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.planKey}</option>)}</select></label><label className="text-xs text-slate-400">Effective plan<select value={planKey} onChange={(event) => setPlanKey(event.target.value)} disabled={!canEdit || pending} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50">{plans.map((plan) => <option key={plan.key} value={plan.key}>{plan.name}</option>)}</select></label><label className="text-xs text-slate-400">Effective until (optional)<input type="date" value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} disabled={!canEdit || pending} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50" /></label><label className="text-xs text-slate-400">Reason<input required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={!canEdit || pending} placeholder="e.g. service recovery" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 disabled:opacity-50" /></label></div><button type="submit" disabled={!canEdit || pending || !workspaceId} className="mt-4 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "Creating…" : "Create override"}</button></form>
}

export function RevokeOverrideButton({ overrideId, canEdit }: { overrideId: string; canEdit: boolean }) {
  const [pending, startTransition] = useTransition()
  return <button type="button" disabled={!canEdit || pending} onClick={() => { const reason = window.prompt("Reason for revoking this override:"); if (reason === null) return; startTransition(async () => { const result = await removeSubscriptionOverride(overrideId, reason); if (result.success) { toast.success("Override revoked"); window.location.reload() } else toast.error("message" in result ? result.message : "Override could not be revoked") }) }} className="rounded-lg border border-rose-400/30 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "Working…" : "Revoke"}</button>
}
