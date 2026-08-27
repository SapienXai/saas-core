"use client"

/* Website image candidates come from operator-approved external URLs; Next Image cannot optimize arbitrary hosts here. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, useTransition } from "react"
import type React from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Check, Clock3, Globe2, ImageIcon, Loader2, MapPin, Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { addPlatformRestaurant, previewPlatformRestaurantWebsiteAction } from "@/app/platform/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { RestaurantSocialLinks, SocialPlatform } from "@/lib/restaurant-profile"
import type { WebsiteImportCandidate, WebsiteImportResult } from "@/lib/website-import"
import { RestaurantAiReadiness } from "@/components/restaurant-ai-readiness"

type AddRestaurantWizardProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type RestaurantDraft = {
  websiteUrl: string
  businessContactEmail: string
  name: string
  description: string
  slug: string
  cuisine: string
  atmosphere: string
  hours: string
  location: string
  phone: string
  address_line1: string
  address_line2: string
  address_locality: string
  address_region: string
  address_postal_code: string
  address_country: string
  latitude: number | null
  longitude: number | null
  timezone: string
  language: string
  socialLinks: RestaurantSocialLinks
  menuUrl: string
  locationUrl: string
  eventsUrl: string
  logoUrl: string
  primaryImageUrl: string
  reservation_enabled: boolean
  opening_time: string
  closing_time: string
  time_slot_duration: number
  advance_booking_days: number
  min_advance_hours: number
  min_party_size: number
  max_party_size: number
  meal_only_reservations: boolean
  allowed_days_of_week: number[]
}

type CreateResult = {
  publicUrl: string
  restaurantId: string
  businessContactEmail: string
  officialDomain: string | null
  websiteAssets?: {
    logo?: { status: string }
    primary?: { status: string }
  } | null
}

const STEP_LABELS = ["Discover", "Edit profile", "Reservation rules"]
const DAY_OPTIONS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const
const SOCIAL_FIELDS: Array<{ key: Exclude<SocialPlatform, "website">; label: string }> = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X" },
]

function emptyDraft(): RestaurantDraft {
  return {
    websiteUrl: "",
    businessContactEmail: "",
    name: "",
    description: "",
    slug: "",
    cuisine: "",
    atmosphere: "",
    hours: "",
    location: "",
    phone: "",
    address_line1: "",
    address_line2: "",
    address_locality: "",
    address_region: "",
    address_postal_code: "",
    address_country: "",
    latitude: null,
    longitude: null,
    timezone: "UTC",
    language: "en",
    socialLinks: {},
    menuUrl: "",
    locationUrl: "",
    eventsUrl: "",
    logoUrl: "",
    primaryImageUrl: "",
    reservation_enabled: true,
    opening_time: "09:00",
    closing_time: "22:00",
    time_slot_duration: 30,
    advance_booking_days: 30,
    min_advance_hours: 2,
    min_party_size: 1,
    max_party_size: 12,
    meal_only_reservations: false,
    allowed_days_of_week: DAY_OPTIONS.map(([day]) => day),
  }
}

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0
}

function limitWords(value: string, maximum: number) {
  const words = value.match(/\S+/g) || []
  if (words.length <= maximum) return value
  return `${words.slice(0, maximum).join(" ")}${value.endsWith(" ") ? " " : ""}`
}

function profileFromImport(result: WebsiteImportResult): RestaurantDraft {
  const profile = result.profile
  const importedSocials = Object.entries(profile.social_links).filter(([platform, value]) => platform !== "website" && Boolean(value)).slice(0, 4)
  return {
    ...emptyDraft(),
    websiteUrl: result.sourceUrl,
    businessContactEmail: profile.business_contact_email || "",
    name: limitWords(profile.name || "", 3),
    description: limitWords(profile.description || "", 15),
    slug: profile.slug || "",
    cuisine: profile.cuisine || "",
    atmosphere: profile.atmosphere || "",
    hours: profile.hours || "",
    location: profile.location || "",
    phone: profile.phone || "",
    address_line1: profile.address_line1 || "",
    address_line2: profile.address_line2 || "",
    address_locality: profile.address_locality || "",
    address_region: profile.address_region || "",
    address_postal_code: profile.address_postal_code || "",
    address_country: profile.address_country || "",
    latitude: profile.latitude ?? null,
    longitude: profile.longitude ?? null,
    timezone: profile.timezone || "UTC",
    language: profile.language || "en",
    socialLinks: {
      website: profile.social_links.website || result.sourceUrl,
      ...Object.fromEntries(importedSocials),
    },
    menuUrl: profile.menu_url || "",
    locationUrl: profile.location_url || "",
    eventsUrl: profile.events_url || "",
    logoUrl: result.logoCandidates[0]?.url || profile.logo_url || "",
    primaryImageUrl: result.bannerCandidates[0]?.url || profile.primary_image_url || "",
  }
}

function inputClass() {
  return "h-11 border-slate-200 bg-white text-slate-950 placeholder:text-slate-400 focus-visible:ring-violet-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-slate-600"
}

function labelClass() {
  return "text-xs font-semibold text-slate-700 dark:text-slate-300"
}

function PlatformAiDetails({ draft, setDraft }: { draft: RestaurantDraft; setDraft: React.Dispatch<React.SetStateAction<RestaurantDraft>> }) {
  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-400/20 dark:bg-violet-500/[0.08]">
      <div><p className="text-sm font-semibold text-slate-900 dark:text-white">AI & search details</p><p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Website data is prefilled. Correct only values the scan could not verify.</p></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["address_line1", "address_line2", "address_locality", "address_region", "address_postal_code", "address_country"] as const).map((field) => <div key={field} className="space-y-1.5"><Label htmlFor={`platform-${field}`} className={labelClass()}>{field.replace("address_", "").replaceAll("_", " ")}</Label><Input id={`platform-${field}`} value={draft[field]} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} className={inputClass()} /></div>)}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="platform-latitude" className={labelClass()}>Latitude</Label><Input id="platform-latitude" type="number" step="any" min="-90" max="90" value={draft.latitude ?? ""} onChange={(event) => setDraft((current) => ({ ...current, latitude: event.target.value === "" ? null : Number(event.target.value) }))} className={inputClass()} /></div>
        <div className="space-y-1.5"><Label htmlFor="platform-longitude" className={labelClass()}>Longitude</Label><Input id="platform-longitude" type="number" step="any" min="-180" max="180" value={draft.longitude ?? ""} onChange={(event) => setDraft((current) => ({ ...current, longitude: event.target.value === "" ? null : Number(event.target.value) }))} className={inputClass()} /></div>
        <div className="space-y-1.5"><Label className={labelClass()}>Official website</Label><Input value={draft.websiteUrl} readOnly className={inputClass()} /></div>
      </div>
      <div className="mt-4"><RestaurantAiReadiness restaurant={{ id: "pending", slug: draft.slug || null, name: draft.name || null, location: draft.location, address_line1: draft.address_line1, address_line2: draft.address_line2, address_locality: draft.address_locality, address_region: draft.address_region, address_postal_code: draft.address_postal_code, address_country: draft.address_country, latitude: draft.latitude, longitude: draft.longitude, phone: draft.phone, official_website_url: draft.websiteUrl, timezone: draft.timezone, status: "published", platform_status: "active", reservation_enabled: draft.reservation_enabled }} /></div>
    </section>
  )
}

function candidateClass(selected: boolean) {
  return `group relative overflow-hidden rounded-2xl border text-left transition ${selected ? "border-violet-500 bg-violet-50 ring-2 ring-violet-500/20 dark:border-violet-400 dark:bg-violet-500/[0.12]" : "border-slate-200 bg-slate-50 hover:border-violet-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-violet-400/60"}`
}

function AssetChoices({ kind, candidates, selectedUrl, onSelect }: { kind: "logo" | "banner"; candidates: WebsiteImportCandidate[]; selectedUrl: string; onSelect: (url: string) => void }) {
  const options = candidates.slice(0, 4)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className={labelClass()}>{kind === "logo" ? "Logo" : "Banner"}</Label>
        <span className="text-[11px] text-slate-500 dark:text-slate-500">Choose one from the website scan</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.length ? options.map((candidate) => (
          <button key={candidate.url} type="button" onClick={() => onSelect(candidate.url)} className={candidateClass(selectedUrl === candidate.url)}>
            <div className={`${kind === "logo" ? "aspect-square" : "aspect-[1.6/1]"} overflow-hidden bg-slate-100 dark:bg-slate-900`}>
              <img src={candidate.url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
            </div>
            <span className="block truncate px-2.5 py-2 text-[10px] text-slate-500 dark:text-slate-400">{candidate.label}</span>
            {selectedUrl === candidate.url ? <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-white"><Check className="h-3.5 w-3.5" /></span> : null}
          </button>
        )) : <div className="col-span-2 flex min-h-24 items-center justify-center rounded-2xl border border-dashed border-slate-200 px-3 text-center text-xs text-slate-500 dark:col-span-4 dark:border-white/10">No {kind} candidate was found. You can add it later from the restaurant detail page.</div>}
      </div>
    </div>
  )
}

export function PlatformAddRestaurantWizard({ open, onOpenChange }: AddRestaurantWizardProps) {
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<RestaurantDraft>(emptyDraft)
  const [importResult, setImportResult] = useState<WebsiteImportResult | null>(null)
  const [result, setResult] = useState<CreateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (open) {
      setStep(1)
      setDraft(emptyDraft())
      setImportResult(null)
      setResult(null)
      setError(null)
    }
  }, [open])

  function close(next: boolean) {
    if (pending) return
    if (!next) onOpenChange(false)
  }

  function scanWebsite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!draft.websiteUrl.trim()) {
      setError("Enter the restaurant website first.")
      return
    }
    startTransition(async () => {
      const response = await previewPlatformRestaurantWebsiteAction({ websiteUrl: draft.websiteUrl })
      if (!response.success) {
        setError(response.message)
        return
      }
      setImportResult(response.data)
      setDraft(profileFromImport(response.data))
      setStep(2)
    })
  }

  function validateProfile() {
    if (!draft.name.trim()) return "Restaurant name is required."
    if (wordCount(draft.name) > 3) return "Keep the restaurant name to 3 words or fewer."
    if (wordCount(draft.description) > 15) return "Keep the description to 15 words or fewer."
    if (!/^\S+@\S+\.\S+$/.test(draft.businessContactEmail.trim())) return "Enter a valid private business contact email."
    if (Object.entries(draft.socialLinks).filter(([platform, value]) => platform !== "website" && Boolean(value)).length > 4) return "Choose no more than 4 social links."
    return null
  }

  function goToRules() {
    const validationError = validateProfile()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setStep(3)
  }

  function createRestaurant() {
    const validationError = validateProfile()
    if (validationError) {
      setStep(2)
      setError(validationError)
      return
    }
    setError(null)
    startTransition(async () => {
      const response = await addPlatformRestaurant({
        name: draft.name,
        businessContactEmail: draft.businessContactEmail,
        officialWebsiteUrl: draft.websiteUrl,
        slug: draft.slug || undefined,
        description: draft.description || undefined,
        cuisine: draft.cuisine || undefined,
        location: draft.location || undefined,
        phone: draft.phone || undefined,
        address_line1: draft.address_line1 || null,
        address_line2: draft.address_line2 || null,
        address_locality: draft.address_locality || null,
        address_region: draft.address_region || null,
        address_postal_code: draft.address_postal_code || null,
        address_country: draft.address_country || null,
        latitude: draft.latitude,
        longitude: draft.longitude,
        hours: draft.hours || undefined,
        atmosphere: draft.atmosphere || undefined,
        timezone: draft.timezone || undefined,
        language: draft.language || undefined,
        logoUrl: draft.logoUrl || null,
        primaryImageUrl: draft.primaryImageUrl || null,
        socialLinks: draft.socialLinks,
        menuUrl: draft.menuUrl || null,
        locationUrl: draft.locationUrl || null,
        eventsUrl: draft.eventsUrl || null,
        reservation_enabled: draft.reservation_enabled,
        opening_time: draft.opening_time,
        closing_time: draft.closing_time,
        time_slot_duration: draft.time_slot_duration,
        advance_booking_days: draft.advance_booking_days,
        min_advance_hours: draft.min_advance_hours,
        min_party_size: draft.min_party_size,
        max_party_size: draft.max_party_size,
        meal_only_reservations: draft.meal_only_reservations,
        allowed_days_of_week: draft.allowed_days_of_week,
      })
      if (!response.success || !("publicUrl" in response)) {
        toast.error(response.message)
        return
      }
      setResult(response)
      toast.success("Claimable restaurant created")
    })
  }

  function updateSocial(platform: Exclude<SocialPlatform, "website">, value: string) {
    setDraft((current) => ({ ...current, socialLinks: { ...current.socialLinks, [platform]: value || undefined } }))
  }

  const socialCount = Object.entries(draft.socialLinks).filter(([platform, value]) => platform !== "website" && Boolean(value)).length
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[min(94dvh,56rem)] overflow-y-auto border-slate-200 bg-white p-0 text-slate-950 shadow-2xl dark:border-white/10 dark:bg-slate-950 dark:text-white sm:max-w-5xl sm:rounded-3xl">
        <div className="border-b border-slate-200 bg-gradient-to-br from-violet-50 via-white to-white px-5 py-5 dark:border-white/10 dark:from-violet-500/[0.12] dark:via-slate-950 dark:to-slate-950 sm:px-7">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5" />Website-powered setup</div>
                <DialogTitle className="text-xl tracking-tight text-slate-950 dark:text-white">Add a claimable restaurant</DialogTitle>
                <DialogDescription className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">Scan the official website, review the profile, then publish it with safe reservation defaults.</DialogDescription>
              </div>
              <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-violet-600 shadow-sm ring-1 ring-slate-200 dark:bg-white/[0.08] dark:text-violet-300 dark:ring-white/10 sm:flex"><Globe2 className="h-5 w-5" /></div>
            </div>
          </DialogHeader>
          {!result ? <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">{STEP_LABELS.map((label, index) => { const number = index + 1; const active = step === number; const complete = step > number; return <div key={label} className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 ${active ? "border-violet-300 bg-violet-100/80 dark:border-violet-400/40 dark:bg-violet-500/[0.14]" : "border-slate-200 bg-white/70 dark:border-white/10 dark:bg-white/[0.03]"}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active || complete ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-white/[0.08] dark:text-slate-500"}`}>{complete ? <Check className="h-3.5 w-3.5" /> : number}</span><span className={`hidden text-xs font-semibold sm:block ${active ? "text-violet-800 dark:text-violet-100" : "text-slate-500 dark:text-slate-500"}`}>{label}</span></div> })}</div> : null}
        </div>

        {!result && step > 1 ? <div className="px-5 pt-5 sm:px-7"><PlatformAiDetails draft={draft} setDraft={setDraft} /></div> : null}

        {result ? <div className="space-y-5 p-5 sm:p-7">
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-400/20 dark:bg-emerald-500/[0.08]"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-5 w-5" /></span><div><p className="font-semibold text-slate-950 dark:text-white">Restaurant is live · Unclaimed</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{result.businessContactEmail} · {result.officialDomain || "Official domain unavailable"}</p><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{result.websiteAssets?.logo?.status === "imported" ? "Logo imported" : "Logo not found"} · {result.websiteAssets?.primary?.status === "imported" ? "Banner imported" : "Banner not found"}</p></div></div></div>
          <div className="flex flex-wrap gap-2"><Button asChild className="min-h-11 gap-2 bg-violet-600 text-white hover:bg-violet-500"><Link href={result.publicUrl} target="_blank" rel="noreferrer">Open public page <ArrowRight className="h-4 w-4" /></Link></Button><Button asChild variant="outline" className="min-h-11 border-slate-200 text-slate-700 dark:border-white/10 dark:text-slate-200"><Link href={`/platform/restaurants/${result.restaurantId}`}>Open details</Link></Button></div>
        </div> : <div className="p-5 sm:p-7">
          {step === 1 ? <form onSubmit={scanWebsite} className="space-y-6"><div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.03] sm:p-7"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><Globe2 className="h-6 w-6" /></div><h3 className="mt-5 text-lg font-semibold text-slate-950 dark:text-white">Start with one website</h3><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">We’ll read public restaurant information and prepare an editable profile. Nothing is published until you review the next step.</p><div className="mt-6 space-y-2"><Label htmlFor="platform-add-website" className={labelClass()}>Official restaurant website</Label><Input id="platform-add-website" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} value={draft.websiteUrl} onChange={(event) => setDraft((current) => ({ ...current, websiteUrl: event.target.value }))} placeholder="felixsmile.com or https://felixsmile.com" className={inputClass()} autoFocus /></div><p className="mt-2 text-xs leading-5 text-slate-500">You can enter a domain like <span className="font-medium text-slate-700 dark:text-slate-300">felixsmile.com</span>; Reservevia will add HTTPS automatically.</p></div><div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.02] sm:p-7"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">What we’ll look for</p><div className="mt-5 space-y-4 text-sm text-slate-700 dark:text-slate-300"><div className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span>Name, short description, cuisine and atmosphere</span></div><div className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span>Opening information, location, phone and social links</span></div><div className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span>Logo and banner candidates from public website metadata</span></div></div><div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/[0.08] dark:text-amber-100">Business contact email is collected in the next step. It is private and receives reservation requests and claim notifications.</div></div></div>{error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/[0.08] dark:text-rose-200">{error}</p> : null}<DialogFooter><Button type="submit" disabled={pending} className="min-h-11 gap-2 bg-violet-600 text-white hover:bg-violet-500">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{pending ? "Scanning website…" : "Scan website"}</Button></DialogFooter></form> : null}

          {step === 2 && importResult ? <div className="space-y-6"><div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]"><div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="platform-add-name" className={labelClass()}>Restaurant name <span className="text-rose-500">*</span></Label><Input id="platform-add-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: limitWords(event.target.value, 3) }))} className={inputClass()} /></div><div className="space-y-2"><Label htmlFor="platform-add-email" className={labelClass()}>Business contact email <span className="text-rose-500">*</span></Label><Input id="platform-add-email" type="email" value={draft.businessContactEmail} onChange={(event) => setDraft((current) => ({ ...current, businessContactEmail: event.target.value }))} placeholder="owner@restaurant.com" className={inputClass()} /><p className="text-[11px] text-slate-500">Private · never shown on the public page</p></div></div><div className="space-y-2"><Label htmlFor="platform-add-description" className={labelClass()}>Short description</Label><Textarea id="platform-add-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: limitWords(event.target.value, 15) }))} className="min-h-24 border-slate-200 bg-white text-slate-950 placeholder:text-slate-400 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-slate-600" /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="platform-add-cuisine" className={labelClass()}>Cuisine</Label><Input id="platform-add-cuisine" value={draft.cuisine} onChange={(event) => setDraft((current) => ({ ...current, cuisine: event.target.value }))} className={inputClass()} placeholder="Modern Anatolian" /></div><div className="space-y-2"><Label htmlFor="platform-add-atmosphere" className={labelClass()}>Atmosphere</Label><Input id="platform-add-atmosphere" value={draft.atmosphere} onChange={(event) => setDraft((current) => ({ ...current, atmosphere: event.target.value }))} className={inputClass()} placeholder="Scenic, relaxed" /></div><div className="space-y-2"><Label htmlFor="platform-add-hours" className={labelClass()}>Public hours</Label><Input id="platform-add-hours" value={draft.hours} onChange={(event) => setDraft((current) => ({ ...current, hours: event.target.value }))} className={inputClass()} placeholder="Daily · 12:00–23:00" /></div><div className="space-y-2"><Label htmlFor="platform-add-location" className={labelClass()}>Location</Label><Input id="platform-add-location" value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} className={inputClass()} placeholder="District or address" /></div></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="platform-add-timezone" className={labelClass()}>Timezone</Label><Input id="platform-add-timezone" value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} className={inputClass()} placeholder="Europe/Istanbul" /></div><div className="space-y-2"><Label htmlFor="platform-add-slug" className={labelClass()}>Public slug</Label><Input id="platform-add-slug" value={draft.slug} onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))} className={inputClass()} placeholder="Generated if blank" /></div></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.03]"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Public links</p><p className="mt-1 text-[11px] text-slate-500">Menu, location and event links found on the website</p></div></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="platform-menu-url" className="text-[11px] text-slate-600 dark:text-slate-400">Menu URL</Label><Input id="platform-menu-url" type="url" value={draft.menuUrl} onChange={(event) => setDraft((current) => ({ ...current, menuUrl: event.target.value }))} placeholder="https://…/menu" className={inputClass()} /></div><div className="space-y-1.5"><Label htmlFor="platform-location-url" className="text-[11px] text-slate-600 dark:text-slate-400">Location URL</Label><Input id="platform-location-url" type="url" value={draft.locationUrl} onChange={(event) => setDraft((current) => ({ ...current, locationUrl: event.target.value }))} placeholder="Google Maps or Waze link" className={inputClass()} /></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="platform-events-url" className="text-[11px] text-slate-600 dark:text-slate-400">Events URL</Label><Input id="platform-events-url" type="url" value={draft.eventsUrl} onChange={(event) => setDraft((current) => ({ ...current, eventsUrl: event.target.value }))} placeholder="Optional events link" className={inputClass()} /></div></div></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.03]"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Social links</p><p className="mt-1 text-[11px] text-slate-500">Imported from the website · up to 4</p></div><span className={`text-xs font-semibold ${socialCount > 4 ? "text-rose-600 dark:text-rose-300" : "text-slate-500"}`}>{socialCount}/4</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{SOCIAL_FIELDS.map(({ key, label }) => <div key={key} className="space-y-1.5"><Label htmlFor={`platform-social-${key}`} className="text-[11px] text-slate-600 dark:text-slate-400">{label}</Label><Input id={`platform-social-${key}`} type="url" value={draft.socialLinks[key] || ""} onChange={(event) => updateSocial(key, event.target.value)} placeholder={`https://${key}.com/…`} className={inputClass()} /></div>)}</div></div></div><aside className="space-y-5"><div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]"><div className="relative aspect-[1.65/1] overflow-hidden bg-slate-200 dark:bg-slate-900">{draft.primaryImageUrl ? <img src={draft.primaryImageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-400"><ImageIcon className="h-8 w-8" /></div>}{draft.logoUrl ? <img src={draft.logoUrl} alt="" className="absolute bottom-3 left-3 h-14 w-14 rounded-2xl border-2 border-white bg-white object-contain p-1 shadow-lg" /> : null}</div><div className="p-4"><p className="truncate text-lg font-semibold text-slate-950 dark:text-white">{draft.name || "Restaurant name"}</p><p className="mt-1 truncate text-xs text-slate-500">{draft.cuisine || "Cuisine"}{draft.atmosphere ? ` · ${draft.atmosphere}` : ""}</p>{draft.description ? <p className="mt-3 line-clamp-3 text-sm leading-5 text-slate-600 dark:text-slate-300">{draft.description}</p> : null}<div className="mt-4 space-y-2 text-xs text-slate-500"><div className="flex gap-2"><Clock3 className="h-3.5 w-3.5" />{draft.hours || "Hours will be set in reservation rules"}</div>{draft.location ? <div className="flex gap-2"><MapPin className="h-3.5 w-3.5" />{draft.location}</div> : null}</div></div></div><AssetChoices kind="logo" candidates={importResult.logoCandidates} selectedUrl={draft.logoUrl} onSelect={(url) => setDraft((current) => ({ ...current, logoUrl: url }))} /><AssetChoices kind="banner" candidates={importResult.bannerCandidates} selectedUrl={draft.primaryImageUrl} onSelect={(url) => setDraft((current) => ({ ...current, primaryImageUrl: url }))} /></aside></div>{error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/[0.08] dark:text-rose-200">{error}</p> : null}<DialogFooter className="gap-2 sm:gap-2"><Button type="button" variant="outline" onClick={() => { setError(null); setStep(1) }} className="min-h-11 gap-2 border-slate-200 text-slate-700 dark:border-white/10 dark:text-slate-200"><ArrowLeft className="h-4 w-4" />Back</Button><Button type="button" onClick={goToRules} className="min-h-11 gap-2 bg-violet-600 text-white hover:bg-violet-500">Continue <ArrowRight className="h-4 w-4" /></Button></DialogFooter></div> : null}

          {step === 3 ? <div className="space-y-6"><div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.03]"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">Step 3 · Reservation rules</p><h3 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">Set safe defaults for incoming requests</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">The page is live, but unclaimed reservations stay as requests until the business accepts them.</p></div><div className="rounded-2xl bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-white/[0.06] dark:text-slate-300">{draft.name || "Restaurant"}</div></div></div><div className="grid gap-5 lg:grid-cols-2"><div className="space-y-4 rounded-3xl border border-slate-200 p-5 dark:border-white/10"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">Accept reservation requests</p><p className="mt-1 text-xs text-slate-500">Keep this on to make the public page bookable.</p></div><input type="checkbox" checked={draft.reservation_enabled} onChange={(event) => setDraft((current) => ({ ...current, reservation_enabled: event.target.checked }))} className="h-5 w-5 accent-violet-600" /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="platform-opening-time" className={labelClass()}>Opening time</Label><Input id="platform-opening-time" type="time" value={draft.opening_time} onChange={(event) => setDraft((current) => ({ ...current, opening_time: event.target.value }))} className={inputClass()} /></div><div className="space-y-2"><Label htmlFor="platform-closing-time" className={labelClass()}>Closing time</Label><Input id="platform-closing-time" type="time" value={draft.closing_time} onChange={(event) => setDraft((current) => ({ ...current, closing_time: event.target.value }))} className={inputClass()} /></div></div><div className="space-y-2"><Label htmlFor="platform-slot-duration" className={labelClass()}>Time slot duration</Label><select id="platform-slot-duration" value={draft.time_slot_duration} onChange={(event) => setDraft((current) => ({ ...current, time_slot_duration: Number(event.target.value) }))} className={`${inputClass()} w-full`}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select></div><div className="space-y-2"><Label className={labelClass()}>Available days</Label><div className="flex flex-wrap gap-2">{DAY_OPTIONS.map(([day, label]) => { const selected = draft.allowed_days_of_week.includes(day); return <button key={day} type="button" onClick={() => setDraft((current) => ({ ...current, allowed_days_of_week: selected ? current.allowed_days_of_week.filter((item) => item !== day) : [...current.allowed_days_of_week, day].sort() }))} className={`min-h-9 rounded-xl border px-3 text-xs font-semibold transition ${selected ? "border-violet-500 bg-violet-100 text-violet-800 dark:border-violet-400 dark:bg-violet-500/15 dark:text-violet-100" : "border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-500"}`}>{label}</button> })}</div></div></div><div className="space-y-4 rounded-3xl border border-slate-200 p-5 dark:border-white/10"><p className="text-sm font-semibold text-slate-900 dark:text-white">Booking limits</p><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="platform-advance-days" className={labelClass()}>Advance booking days</Label><Input id="platform-advance-days" type="number" min={1} max={365} value={draft.advance_booking_days} onChange={(event) => setDraft((current) => ({ ...current, advance_booking_days: Number(event.target.value) }))} className={inputClass()} /></div><div className="space-y-2"><Label htmlFor="platform-min-advance" className={labelClass()}>Minimum notice (hours)</Label><Input id="platform-min-advance" type="number" min={0} max={720} value={draft.min_advance_hours} onChange={(event) => setDraft((current) => ({ ...current, min_advance_hours: Number(event.target.value) }))} className={inputClass()} /></div><div className="space-y-2"><Label htmlFor="platform-min-party" className={labelClass()}>Minimum party size</Label><Input id="platform-min-party" type="number" min={1} max={100} value={draft.min_party_size} onChange={(event) => setDraft((current) => ({ ...current, min_party_size: Number(event.target.value) }))} className={inputClass()} /></div><div className="space-y-2"><Label htmlFor="platform-max-party" className={labelClass()}>Maximum party size</Label><Input id="platform-max-party" type="number" min={1} max={100} value={draft.max_party_size} onChange={(event) => setDraft((current) => ({ ...current, max_party_size: Number(event.target.value) }))} className={inputClass()} /></div></div><label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300"><input type="checkbox" checked={draft.meal_only_reservations} onChange={(event) => setDraft((current) => ({ ...current, meal_only_reservations: event.target.checked }))} className="h-4 w-4 accent-violet-600" />Meal-only reservations</label></div></div>{draft.allowed_days_of_week.length === 0 ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/[0.08] dark:text-amber-100">Select at least one available day.</p> : null}{draft.max_party_size < draft.min_party_size ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/[0.08] dark:text-rose-200">Maximum party size cannot be smaller than minimum party size.</p> : null}<DialogFooter className="gap-2 sm:gap-2"><Button type="button" variant="outline" onClick={() => { setError(null); setStep(2) }} className="min-h-11 gap-2 border-slate-200 text-slate-700 dark:border-white/10 dark:text-slate-200"><ArrowLeft className="h-4 w-4" />Back</Button><Button type="button" disabled={pending || draft.allowed_days_of_week.length === 0 || draft.max_party_size < draft.min_party_size} onClick={createRestaurant} className="min-h-11 gap-2 bg-violet-600 text-white hover:bg-violet-500">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{pending ? "Creating…" : "Create live restaurant"}</Button></DialogFooter>{error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/[0.08] dark:text-rose-200">{error}</p> : null}</div> : null}
        </div>}
      </DialogContent>
    </Dialog>
  )
}
