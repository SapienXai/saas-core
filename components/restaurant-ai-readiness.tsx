"use client"

import type React from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, Sparkles } from "lucide-react"
import { evaluateRestaurantAiReadiness, type AiReadinessRestaurant } from "@/lib/ai/readiness-shared"

const LABELS: Record<string, string> = {
  stable_id: "Stable restaurant identity",
  name: "Restaurant name",
  slug: "Public slug",
  publication_status: "Published status",
  platform_status: "Active platform status",
  booking_capability: "Reservations enabled",
  formatted_address: "Structured address",
  latitude: "Latitude and longitude",
  longitude: "Latitude and longitude",
  phone_number: "Phone number",
  official_website_url: "Official website",
  canonical_url: "Reservevia canonical URL",
  timezone: "Restaurant timezone",
}

export function RestaurantAiReadiness({
  restaurant,
  canonicalUrl,
  compact = false,
  details,
}: {
  restaurant: AiReadinessRestaurant
  canonicalUrl?: string | null
  compact?: boolean
  details?: {
    label: string
    summary?: string
    open: boolean
    onOpenChange: (open: boolean) => void
    children: React.ReactNode
  }
}) {
  const readiness = evaluateRestaurantAiReadiness(restaurant, canonicalUrl ?? (restaurant.slug ? "auto-generated" : null))
  const missing = Array.from(new Set(readiness.missing))

  return (
    <section className={`rounded-2xl border ${compact ? "p-3 sm:p-3.5" : "p-4"} ${readiness.eligible ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex shrink-0 items-center justify-center rounded-xl ${compact ? "h-7 w-7" : "h-8 w-8"} ${readiness.eligible ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {readiness.eligible ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-950">AI readiness</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${readiness.eligible ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {readiness.eligible ? "Ready" : "Needs a few details"}
            </span>
          </div>
          {!compact ? <p className="mt-1 text-xs leading-5 text-slate-600">We filled what Reservevia already knows. Only the missing, verifiable fields need attention before AI discovery.</p> : null}
          {missing.length ? (
            <div className="mt-3 space-y-1.5">
              {missing.map((field) => <div key={field} className="flex items-center gap-2 text-xs text-amber-900"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>{LABELS[field] || field.replaceAll("_", " ")}</span></div>)}
            </div>
          ) : <p className="mt-2 text-xs font-medium text-emerald-800">This restaurant can be included in the strict public AI business feed.</p>}
          {readiness.warnings.length ? <p className="mt-2 text-[11px] text-slate-600">Optional enrichment: {readiness.warnings.map((warning) => warning.replaceAll(".", " ")).join(", ")}</p> : null}
        </div>
      </div>
      {details ? (
        <div className={`mt-3 border-t pt-2.5 ${readiness.eligible ? "border-emerald-200/80" : "border-amber-200/80"}`}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1 text-left transition-colors hover:bg-white/45"
            onClick={() => details.onOpenChange(!details.open)}
            aria-expanded={details.open}
          >
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-800">{details.label}</span>
              {details.summary ? <span className="mt-0.5 block truncate text-[11px] text-slate-600">{details.summary}</span> : null}
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${details.open ? "rotate-180" : ""}`} />
          </button>
          {details.open ? <div className="mt-2 border-t border-slate-900/5 pt-3">{details.children}</div> : null}
        </div>
      ) : null}
    </section>
  )
}
