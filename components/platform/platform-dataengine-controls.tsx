"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Check, ImageIcon, Loader2, Mail, RefreshCw, ShieldAlert, X } from "lucide-react"
import { toast } from "sonner"
import {
  correctDataEngineBusinessEmailAction,
  overrideDataEngineLeadReadinessAction,
  prepareDataEngineLeadBannerAction,
  retryDataEngineEmailAction,
  retryDataEngineLeadPublishAction,
  reviewDataEngineLeadsAction,
} from "@/app/platform/actions"
import { PlatformSurface } from "@/components/platform/platform-primitives"

type Lead = {
  id: string
  name: string
  city: string | null
  address: string | null
  official_website_url: string | null
  official_domain: string | null
  source_candidate_status: string
  source_classification: string | null
  fit_score: number | null
  data_confidence: number | null
  enrichment_status: string | null
  business_match: string | null
  readiness_status: string
  review_status: string
  restaurant_id: string | null
  duplicate_restaurant_id: string | null
  conflict_reason: string | null
  business_contact_email: string | null
  staged_banner_source_type: string | null
  staged_banner_source_url: string | null
  staged_banner_width: number | null
  staged_banner_height: number | null
  banner_preview_url: string | null
  evidence: Array<{ field: string; value: string; source_url: string | null; confidence: string | null; business_match: string | null; scope: string | null }>
  publish_status?: string
  publish_phase?: string
  publish_attempt_count?: number
  publish_error?: string | null
  banner_status?: string
  claimed_conflict?: boolean
  business_email_delivery_status?: string | null
  business_email_last_error?: string | null
  business_email_delivery_event_id?: string | null
  business_email_attempt_count?: number
}

export function PlatformDataEngineControls({ batchId, leads, canWrite }: { batchId: string; leads: Lead[]; canWrite: boolean }) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const pendingLeads = useMemo(() => leads.filter((lead) => lead.review_status === "pending"), [leads])
  const selectedLeads = leads.filter((lead) => selected.includes(lead.id))

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function toggleAll() {
    setSelected(selected.length === pendingLeads.length ? [] : pendingLeads.map((lead) => lead.id))
  }

  function stageBanners() {
    const reason = window.prompt("Required reason for preparing these banner previews:")
    if (!reason?.trim()) return
    startTransition(async () => {
      let staged = 0
      let failed = 0
      for (const lead of selectedLeads.length ? selectedLeads : pendingLeads) {
        const result = await prepareDataEngineLeadBannerAction(lead.id, reason)
        if (result.success) staged += 1
        else failed += 1
      }
      toast[failed ? "warning" : "success"](`${staged} banner preview${staged === 1 ? "" : "s"} prepared${failed ? `; ${failed} failed and remain in review` : ""}.`)
      router.refresh()
    })
  }

  function review(decision: "approve" | "reject") {
    if (!selected.length) return
    const reason = window.prompt(`Required reason for ${decision === "approve" ? "approving" : "rejecting"} the selected leads:`)
    if (!reason?.trim()) return
    startTransition(async () => {
      const result = await reviewDataEngineLeadsAction({ batchId, leadIds: selected, decision, reason })
      if (!result.success) toast.error(result.message)
      else {
        const blocked = result.results.filter((item: any) => item.status === "blocked").length
        toast.success(decision === "approve" ? `${result.results.length - blocked} lead(s) published.` : `${result.results.length} lead(s) rejected.`)
        setSelected([])
        router.refresh()
      }
    })
  }

  function retryPublish(leadId: string) {
    const reason = window.prompt("Required reason for retrying publication:")
    if (!reason?.trim()) return
    startTransition(async () => {
      const result = await retryDataEngineLeadPublishAction(leadId, reason)
      if (!result.success) toast.error(result.message)
      else {
        toast.success("Publication retry completed.")
        router.refresh()
      }
    })
  }

  function retryBanner(leadId: string) {
    const reason = window.prompt("Required reason for retrying banner staging:")
    if (!reason?.trim()) return
    startTransition(async () => {
      const result = await prepareDataEngineLeadBannerAction(leadId, reason)
      if (!result.success) toast.error(result.message)
      else {
        toast.success("Banner staging retry completed.")
        router.refresh()
      }
    })
  }

  function retryEmail(eventId: string) {
    const reason = window.prompt("Required reason for retrying this notification:")
    if (!reason?.trim()) return
    startTransition(async () => {
      const result = await retryDataEngineEmailAction(eventId, reason)
      if (!result.success) toast.error(result.message)
      else {
        toast.success("Transactional email retry queued.")
        router.refresh()
      }
    })
  }

  function correctEmail(restaurantId: string) {
    const email = window.prompt("Correct business notification email:")
    const reason = window.prompt("Required reason for correcting the email:")
    if (!email?.trim() || !reason?.trim()) return
    startTransition(async () => {
      const result = await correctDataEngineBusinessEmailAction({ restaurantId, email, reason })
      if (!result.success) toast.error(result.message)
      else {
        toast.success("Business notification email corrected and delivery unpaused.")
        router.refresh()
      }
    })
  }

  function overrideReadiness(leadId: string) {
    const reason = window.prompt("Required reason for this single-record readiness override:")
    if (!reason?.trim()) return
    startTransition(async () => {
      const result = await overrideDataEngineLeadReadinessAction({ batchId, leadId, reason })
      if (!result.success) toast.error(result.message)
      else {
        toast.success("Readiness override saved.")
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <PlatformSurface className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Lead review</p>
            <p className="mt-1 text-xs text-slate-500">Select pending leads. Approve publishes an unclaimed restaurant only when the local banner and verified first-party email are ready.</p>
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={toggleAll} className="min-h-10 rounded-xl border border-white/10 px-3 text-xs font-semibold text-slate-300 hover:bg-white/[0.06]">{selected.length === pendingLeads.length ? "Clear selection" : "Select pending"}</button>
              <button type="button" disabled={pending || !pendingLeads.length} onClick={stageBanners} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 text-xs font-semibold text-sky-200 disabled:opacity-50">{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}Prepare banner previews</button>
              <button type="button" disabled={pending || !selected.length} onClick={() => review("approve")} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-500 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Approve selected</button>
              <button type="button" disabled={pending || !selected.length} onClick={() => review("reject")} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 text-xs font-semibold text-rose-200 disabled:opacity-50"><X className="h-3.5 w-3.5" />Reject selected</button>
            </div>
          ) : <p className="text-xs text-slate-500">Read-only platform role</p>}
        </div>
      </PlatformSurface>

      <div className="space-y-3">
        {leads.map((lead) => (
          <article key={lead.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row">
              <div className="flex min-w-0 flex-1 gap-3">
                {canWrite && lead.review_status === "pending" ? <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggle(lead.id)} aria-label={`Select ${lead.name}`} className="mt-1 h-4 w-4 accent-violet-500" /> : null}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{lead.name}</h3>
                    <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold capitalize text-violet-200">{lead.review_status}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${lead.readiness_status === "ready" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" : lead.readiness_status === "duplicate" ? "border-rose-400/25 bg-rose-500/10 text-rose-300" : "border-amber-400/25 bg-amber-500/10 text-amber-300"}`}>{lead.readiness_status.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{lead.city || "Unknown city"}{lead.address ? ` · ${lead.address}` : ""}</p>
                  <p className="mt-2 break-all text-xs text-slate-400">{lead.official_website_url || lead.official_domain || "No official website"}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400"><span>Fit {lead.fit_score ?? "—"}</span><span>Confidence {lead.data_confidence ?? "—"}</span><span>Candidate {lead.source_candidate_status}</span><span>Match {lead.business_match || "—"}</span><span>Publish {lead.publish_status || "pending"} ({lead.publish_attempt_count || 0})</span></div>
                </div>
              </div>
              <div className="w-full shrink-0 xl:w-72">
                {lead.banner_preview_url ? <Image src={lead.banner_preview_url} alt={`${lead.name} staged banner`} width={lead.staged_banner_width || 1440} height={lead.staged_banner_height || 800} unoptimized className="aspect-[16/8] w-full rounded-xl border border-white/10 object-cover" /> : <div className="flex aspect-[16/8] items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/10 text-xs text-slate-600">No local banner staged</div>}
                <p className="mt-2 text-[11px] text-slate-500">{lead.staged_banner_source_type || "Pending"}{lead.staged_banner_width ? ` · ${lead.staged_banner_width}×${lead.staged_banner_height}` : ""} · {lead.banner_status || "pending"}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
              {canWrite && lead.banner_status === "failed" ? <button type="button" onClick={() => retryBanner(lead.id)} disabled={pending} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 text-xs font-semibold text-sky-200 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Retry banner</button> : null}
              {canWrite && lead.publish_status === "failed" ? <button type="button" onClick={() => retryPublish(lead.id)} disabled={pending} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Retry publish</button> : null}
              {canWrite && lead.business_email_delivery_event_id && lead.business_email_delivery_status === "failed" ? <button type="button" onClick={() => retryEmail(lead.business_email_delivery_event_id as string)} disabled={pending} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-orange-400/25 bg-orange-500/10 px-3 text-xs font-semibold text-orange-200 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Retry notification</button> : null}
              {canWrite && lead.restaurant_id && ["hard_bounce", "paused", "bounced"].includes(lead.business_email_delivery_status || "") && !lead.claimed_conflict ? <button type="button" onClick={() => correctEmail(lead.restaurant_id as string)} disabled={pending} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 text-xs font-semibold text-rose-200">Correct email</button> : null}
              {canWrite && lead.readiness_status === "needs_review" && !lead.claimed_conflict ? <button type="button" onClick={() => overrideReadiness(lead.id)} disabled={pending} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 text-xs font-semibold text-violet-200 disabled:opacity-50">Single-record override</button> : null}
              {lead.claimed_conflict ? <span className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200">Claimed restaurant: private suggestion only</span> : null}
            </div>

            <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-3">
              <div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-slate-600"><Mail className="h-3 w-3" />Private business email</p>
                <p className="mt-1 break-all text-sm text-slate-300">{lead.business_contact_email || "Missing / unverified"}<span className="mt-1 block text-xs text-slate-500">Delivery {lead.business_email_delivery_status || "not sent"} · attempts {lead.business_email_attempt_count || 0}</span>{lead.business_email_last_error ? <span className="mt-1 block text-xs text-rose-300">{lead.business_email_last_error}</span> : null}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-slate-600"><ShieldAlert className="h-3 w-3" />Conflict</p>
                <p className="mt-1 text-sm text-slate-300">{lead.conflict_reason || "No conflict"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Evidence</p>
                <p className="mt-1 text-sm text-slate-300">{lead.evidence.length} private item(s) · {lead.enrichment_status || "status unavailable"}</p>
                {lead.publish_error ? <p className="mt-1 text-xs text-rose-300">Publish error: {lead.publish_error}</p> : null}
              </div>
            </div>

            {lead.evidence.length ? <details className="mt-3 rounded-xl bg-black/10 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-400">View private evidence</summary><div className="mt-3 space-y-2">{lead.evidence.slice(0, 20).map((evidence, index) => <div key={`${lead.id}-${index}`} className="rounded-lg border border-white/[0.08] p-2.5 text-xs"><p className="font-medium text-slate-300">{evidence.field}: {evidence.value}</p><p className="mt-1 break-all text-slate-600">{evidence.source_url || "No source URL"} · {evidence.confidence || "unknown"} · {evidence.scope || "unknown"}</p></div>)}</div></details> : null}
          </article>
        ))}
      </div>
    </div>
  )
}
