"use client"

/* eslint-disable @next/next/no-img-element */

import type React from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Facebook,
  Globe2,
  ImagePlus,
  Instagram,
  Link2,
  Loader2,
  MapPin,
  Music2,
  Pencil,
  Phone,
  Search,
  Sparkles,
  Twitter,
  Utensils,
  Youtube,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  bootstrapOnboarding,
  createAdditionalRestaurant,
  importRestaurantFromWebsite,
  publishManagedOnboardingRestaurant,
  publishOnboardingRestaurant,
  saveManagedOnboardingProfile,
  saveOnboardingProfile,
} from "@/app/onboarding/actions"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { normalizeSocialLinks, slugifyRestaurantName, validateRestaurantSlug, SOCIAL_PLATFORMS, type RestaurantProfileInput, type SocialPlatform } from "@/lib/restaurant-profile"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"
import type { WebsiteImportResult } from "@/lib/website-import"
import type { Restaurant } from "@/types/supabase"
import { useLanguage } from "@/context/language-context"
import type { TranslationKey, TranslationReplacements } from "@/i18n"
import { RestaurantAiReadiness } from "@/components/restaurant-ai-readiness"
import { OnboardingShell } from "@/components/onboarding/onboarding-shell"
import { trackMarketingEvent } from "@/lib/marketing/analytics"

type OnboardingPhase = "source" | "scanning" | "review" | "done"
type OnboardingWizardMode = "initial" | "additional"

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const SCAN_STAGES = [
  "onboarding.scanOpening",
  "onboarding.scanIdentity",
  "onboarding.scanImages",
  "onboarding.scanLinks",
  "onboarding.scanProfile",
] as const

const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  website: "Website",
}

function initialProfile(restaurant: Restaurant | null): RestaurantProfileInput {
  return {
    name: restaurant?.name || "",
    slug: restaurant?.slug || "",
    logo_url: getSafeRestaurantAssetUrl(restaurant?.logo_url),
    primary_image_url: getSafeRestaurantAssetUrl(restaurant?.primary_image_url),
    description: restaurant?.description || null,
    cuisine: restaurant?.cuisine || null,
    atmosphere: restaurant?.atmosphere || null,
    hours: restaurant?.hours || null,
    location: restaurant?.location || null,
    phone: restaurant?.phone || null,
    whatsapp: restaurant?.phone || restaurant?.whatsapp || null,
    menu_url: restaurant?.menu_url || null,
    location_url: restaurant?.location_url || null,
    events_url: restaurant?.events_url || null,
    social_links: normalizeSocialLinks(restaurant?.social_links),
    timezone: restaurant?.timezone || "UTC",
    language: restaurant?.language || "en",
    address_line1: restaurant?.address_line1 || null,
    address_line2: restaurant?.address_line2 || null,
    address_locality: restaurant?.address_locality || null,
    address_region: restaurant?.address_region || null,
    address_postal_code: restaurant?.address_postal_code || null,
    address_country: restaurant?.address_country || null,
    latitude: restaurant?.latitude ?? null,
    longitude: restaurant?.longitude ?? null,
    official_website_url: restaurant?.official_website_url || normalizeSocialLinks(restaurant?.social_links).website || null,
    status: "unpublished",
  }
}

function assetPath(url: string | null | undefined) {
  const marker = "/storage/v1/object/public/restaurant-assets/"
  const index = url?.indexOf(marker) ?? -1
  return index >= 0 ? decodeURIComponent(url!.slice(index + marker.length)) : null
}

function fileError(file: File) {
  if (!file.type.startsWith("image/")) return "type" as const
  if (file.size > MAX_IMAGE_SIZE) return "size" as const
  return null
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return url
}

function isValidWebsiteInput(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`)
    return /^https?:$/i.test(url.protocol) && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function OnboardingWizard({
  initialRestaurant,
  initialWorkspaceId,
  rootDomain,
  checkoutPlan = null,
  checkoutInterval = "month",
  mode = "initial",
  exitHref = "/manage",
}: {
  initialRestaurant: Restaurant | null
  initialWorkspaceId: string | null
  rootDomain: string
  checkoutPlan?: string | null
  checkoutInterval?: string
  mode?: OnboardingWizardMode
  exitHref?: string
}) {
  const router = useRouter()
  const { getTranslation, translateMessage } = useLanguage()
  const isAdditionalRestaurant = mode === "additional"
  const [phase, setPhase] = useState<OnboardingPhase>("source")
  const [websiteUrl, setWebsiteUrl] = useState(normalizeSocialLinks(initialRestaurant?.social_links).website || "")
  const [profile, setProfile] = useState<RestaurantProfileInput>(() => initialProfile(initialRestaurant))
  const [restaurantId, setRestaurantId] = useState(initialRestaurant?.id || "")
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId || initialRestaurant?.workspace_id || "")
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [primaryFile, setPrimaryFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<WebsiteImportResult | null>(null)
  const [scanStage, setScanStage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null)
  const [slugEdited, setSlugEdited] = useState(Boolean(initialRestaurant?.slug))

  const logoPreviewUrl = useObjectUrl(logoFile) || profile.logo_url || null
  const primaryPreviewUrl = useObjectUrl(primaryFile) || profile.primary_image_url || null
  const previewSlug = profile.slug || "your-restaurant"
  const hostedPreviewUrl = `https://${previewSlug}.${rootDomain}`

  const setField = <K extends keyof RestaurantProfileInput>(field: K, value: RestaurantProfileInput[K]) => {
    setProfile((current) => ({ ...current, [field]: value }))
  }

  function updateName(value: string) {
    setProfile((current) => ({ ...current, name: value, slug: slugEdited ? current.slug : slugifyRestaurantName(value) }))
  }

  function updateSocial(platform: SocialPlatform, value: string) {
    setProfile((current) => ({ ...current, social_links: { ...normalizeSocialLinks(current.social_links), [platform]: value || undefined } }))
  }

  function chooseImage(kind: "logo" | "primary", file: File | undefined) {
    if (!file) return
    const validationError = fileError(file)
    if (validationError) {
      setError(getTranslation(validationError === "type" ? "onboarding.fileErrorType" : "onboarding.fileErrorSize"))
      return
    }
    if (kind === "logo") setLogoFile(file)
    else setPrimaryFile(file)
  }

  async function importWebsite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!websiteUrl.trim() || !isValidWebsiteInput(websiteUrl)) {
      setError(getTranslation("onboarding.websiteRequired"))
      return
    }

    setError("")
    setPhase("scanning")
    setScanStage(0)
    const startedAt = Date.now()
    const stageTimer = window.setInterval(() => setScanStage((current) => Math.min(current + 1, SCAN_STAGES.length - 1)), 950)

    try {
      const result = await importRestaurantFromWebsite({ websiteUrl })
      const remainingMinimumTime = Math.max(0, 1_500 - (Date.now() - startedAt))
      if (remainingMinimumTime) await new Promise((resolve) => window.setTimeout(resolve, remainingMinimumTime))
      if (!result.success || !result.data) throw new Error(translateMessage(result.message || getTranslation("onboarding.importFailed")))

      setScanStage(SCAN_STAGES.length - 1)
      setImportResult(result.data)
      setWebsiteUrl(result.data.sourceUrl)
      setProfile({ ...result.data.profile, slug: initialRestaurant?.slug || result.data.profile.slug, status: "unpublished" })
      setLogoFile(null)
      setPrimaryFile(null)
      setSlugEdited(Boolean(initialRestaurant?.slug))
      setPhase("review")
    } catch (caught) {
      setPhase("source")
      setError(caught instanceof Error ? translateMessage(caught.message) : getTranslation("onboarding.importFailed"))
    } finally {
      window.clearInterval(stageTimer)
    }
  }

  function useExistingProfile() {
    setError("")
    setPhase("review")
  }

  async function upload(kind: "logo" | "primary", file: File, targetRestaurantId: string, targetWorkspaceId: string) {
    if (!targetWorkspaceId || !targetRestaurantId) throw new Error(getTranslation("onboarding.createBeforeUpload"))
    const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "image"
    const path = `${targetWorkspaceId}/${targetRestaurantId}/${kind}/${crypto.randomUUID()}.${extension}`
    const supabase = getSupabaseBrowserClient()
    const { error: uploadError } = await supabase.storage.from("restaurant-assets").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    })
    if (uploadError) throw new Error(uploadError.message)
    return supabase.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl
  }

  async function ensureRestaurant(): Promise<{ id: string; workspaceId: string; slug: string }> {
    if (restaurantId && workspaceId) return { id: restaurantId, workspaceId, slug: profile.slug || slugifyRestaurantName(profile.name || "restaurant") }

    const restaurantName = profile.name?.trim()
    const slug = (profile.slug || slugifyRestaurantName(restaurantName || "restaurant")).trim().toLowerCase()
    const slugError = validateRestaurantSlug(slug)
    if (!restaurantName) throw new Error(getTranslation("onboarding.nameRequired"))
    if (slugError) throw new Error(slugError)

    const result = isAdditionalRestaurant
      ? await createAdditionalRestaurant({ restaurantName, restaurantSlug: slug, workspaceId: workspaceId || undefined })
      : await bootstrapOnboarding({ restaurantName, workspaceName: restaurantName, restaurantSlug: slug })
    if (!result.success || !result.data) {
      const failure = result as { message?: string; code?: string; suggestedSlug?: string }
      if (failure.code === "SLUG_CONFLICT" && failure.suggestedSlug) {
        setSlugEdited(true)
        setProfile((current) => ({ ...current, slug: failure.suggestedSlug }))
        throw new Error(`${translateMessage(failure.message || getTranslation("onboarding.setupStartError"))} ${getTranslation("onboarding.suggestedAddressSuffix")}`)
      }
      throw new Error(translateMessage(failure.message || getTranslation("onboarding.setupStartError")))
    }

    const nextRestaurantId = result.data.restaurant_id
    const nextWorkspaceId = result.data.workspace_id || workspaceId
    trackMarketingEvent("restaurant_created", { source: "onboarding" })
    setRestaurantId(nextRestaurantId)
    setWorkspaceId(nextWorkspaceId)
    setProfile((current) => ({ ...current, name: restaurantName, slug: result.data!.restaurant_slug }))
    return { id: nextRestaurantId, workspaceId: nextWorkspaceId, slug: result.data.restaurant_slug }
  }

  async function saveProfile() {
    setLoading(true)
    setError("")
    const uploaded: string[] = []

    try {
      const target = await ensureRestaurant()
      let logoUrl = profile.logo_url || null
      let primaryUrl = profile.primary_image_url || null
      if (logoFile) {
        logoUrl = await upload("logo", logoFile, target.id, target.workspaceId)
        uploaded.push(assetPath(logoUrl) || "")
      }
      if (primaryFile) {
        primaryUrl = await upload("primary", primaryFile, target.id, target.workspaceId)
        uploaded.push(assetPath(primaryUrl) || "")
      }

      const nextProfile: RestaurantProfileInput = {
        ...profile,
        name: profile.name.trim(),
        slug: (target.slug || profile.slug || slugifyRestaurantName(profile.name)).trim().toLowerCase(),
        logo_url: logoUrl,
        primary_image_url: primaryUrl,
        whatsapp: profile.phone || null,
        status: "unpublished",
      }
      const result = isAdditionalRestaurant
        ? await saveManagedOnboardingProfile(target.id, nextProfile)
        : await saveOnboardingProfile(target.id, nextProfile)
      if (!result.success) throw new Error(translateMessage(result.message || getTranslation("onboarding.saveError")))

      const oldPaths = [
        logoFile ? assetPath(initialRestaurant?.logo_url) : null,
        primaryFile ? assetPath(initialRestaurant?.primary_image_url) : null,
      ].filter((value): value is string => Boolean(value))
      if (oldPaths.length) await getSupabaseBrowserClient().storage.from("restaurant-assets").remove(oldPaths)

      setProfile(nextProfile)
      setLogoFile(null)
      setPrimaryFile(null)
      return target
    } catch (caught) {
      for (const path of uploaded.filter(Boolean)) await getSupabaseBrowserClient().storage.from("restaurant-assets").remove([path])
      setError(caught instanceof Error ? translateMessage(caught.message) : getTranslation("onboarding.saveError"))
      return null
    } finally {
      setLoading(false)
    }
  }

  async function openPreview() {
    const previewWindow = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null
    const target = await saveProfile()
    if (!target) {
      previewWindow?.close()
      return
    }
    const previewUrl = `/onboarding/preview?restaurantId=${encodeURIComponent(target.id)}`
    if (previewWindow) previewWindow.location.href = previewUrl
    else router.push(previewUrl)
  }

  async function publish() {
    const target = await saveProfile()
    if (!target) return
    setLoading(true)
    setError("")
    const result = isAdditionalRestaurant
      ? await publishManagedOnboardingRestaurant(target.id)
      : await publishOnboardingRestaurant(target.id)
    setLoading(false)
    if (!result.success) {
      setError(translateMessage(result.message || getTranslation("onboarding.publishError")))
      return
    }
    trackMarketingEvent("restaurant_published", { source: "onboarding" })
    setPublishedSlug(result.slug || profile.slug || null)
    setPhase("done")
  }

  if (phase === "done" && publishedSlug) {
    const publishedUrl = `https://${publishedSlug}.${rootDomain}`
    const publishedHref = process.env.NODE_ENV === "production" ? publishedUrl : `/r/${publishedSlug}`
    return (
      <OnboardingShell phase="done" isAdditionalRestaurant={isAdditionalRestaurant} exitHref={exitHref} getTranslation={getTranslation}>
        <section className="mx-auto max-w-3xl rounded-[2rem] border border-emerald-200 bg-white p-6 shadow-sm animate-in fade-in zoom-in-95 duration-500 sm:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><Check className="h-7 w-7" /></div>
          <p className="mt-7 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">{getTranslation("onboarding.profileReady")}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{getTranslation("onboarding.readyTitle")}</h1>
          <p className="mt-3 max-w-lg text-stone-600">{isAdditionalRestaurant ? getTranslation("onboarding.additionalReady") : getTranslation("onboarding.initialReady")} <span className="font-medium text-stone-900">{publishedUrl}</span>.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-12 rounded-xl bg-stone-950 text-white hover:bg-stone-800"><Link href={publishedHref} target="_blank">{getTranslation("onboarding.viewRestaurant")} <ExternalLink className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="h-12 rounded-xl"><Link href={checkoutPlan ? `/manage/plan?plan=${encodeURIComponent(checkoutPlan)}&interval=${encodeURIComponent(checkoutInterval)}` : "/manage"}>{checkoutPlan ? "Continue to billing" : getTranslation("onboarding.continueDashboard")}</Link></Button>
          </div>
        </section>
      </OnboardingShell>
    )
  }

  return (
    <OnboardingShell phase={phase} isAdditionalRestaurant={isAdditionalRestaurant} exitHref={exitHref} getTranslation={getTranslation}>
      <div className="space-y-6">
      {phase !== "source" && <header className="flex flex-col gap-3 rounded-[1.5rem] border border-stone-200/80 bg-white/80 px-4 py-4 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{isAdditionalRestaurant ? getTranslation("onboarding.restaurantSetupKicker") : getTranslation("onboarding.setupKicker")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{phase === "scanning" ? getTranslation("onboarding.scanningTitle") : getTranslation("onboarding.reviewTitle")}</h1>
        </div>
        {phase === "review" && <div className="hidden items-center gap-2 text-sm text-stone-500 sm:flex"><Sparkles className="h-4 w-4 text-amber-500" /> {getTranslation("onboarding.importKicker")}</div>}
      </header>}

      {error && phase !== "review" && <Alert variant="destructive" className="animate-in slide-in-from-top-2 fade-in duration-300"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}

      {phase === "source" && (
        <div className="mx-auto max-w-5xl">
          <form onSubmit={importWebsite} className="flex flex-col gap-2 rounded-[1.35rem] border border-stone-200 bg-white p-2 shadow-sm transition focus-within:border-stone-400 focus-within:shadow-md sm:flex-row sm:items-center">
            <div className="relative flex min-h-12 flex-1 items-center"><Link2 className="pointer-events-none absolute left-4 h-4 w-4 text-stone-400" /><Input id="onboarding-website" type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder={getTranslation("onboarding.websiteUrlPlaceholder")} className="h-12 rounded-xl border-0 bg-transparent pl-11 shadow-none focus-visible:ring-0" aria-label={getTranslation("onboarding.websiteUrlLabel")} autoFocus required /></div>
            <Button type="submit" className="h-12 w-full rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800 sm:w-auto"><Search className="h-4 w-4" /> {getTranslation("onboarding.importButton")}</Button>
          </form>
          <button
            type="button"
            onClick={() => { setError(""); setImportResult(null); setPhase("review") }}
            className="mx-auto mt-3 block w-fit text-center text-xs font-semibold text-stone-600 underline decoration-stone-300 underline-offset-4 transition hover:text-stone-950 sm:mx-0 sm:text-left"
          >
            {getTranslation("onboarding.manualSetup")}
          </button>
          {initialRestaurant?.name && <div className="mt-3 flex min-h-5 items-center justify-end px-2 text-xs"><button type="button" onClick={useExistingProfile} className="inline-flex shrink-0 items-center gap-1 font-medium text-stone-700 hover:text-stone-950"><Pencil className="h-3.5 w-3.5" /> {getTranslation("onboarding.useExisting")}</button></div>}
          <div className="mt-5 grid items-start gap-4 sm:mt-6 sm:gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(320px,0.65fr)]">
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-[1.5rem] sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-950 text-white"><Globe2 className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-tight sm:text-lg">{getTranslation("onboarding.websiteImportTitle")}</p>
                  <p className="mt-1 text-xs leading-5 text-stone-600 sm:text-sm">{getTranslation("onboarding.websiteImportDescription")}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-stone-100 pt-3 text-[10px] font-semibold text-stone-600 sm:gap-2 sm:text-xs">
                <span className="rounded-full bg-stone-100 px-2.5 py-1 sm:px-3 sm:py-1.5">{getTranslation("onboarding.logo")}</span>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 sm:px-3 sm:py-1.5">{getTranslation("onboarding.primaryImage")}</span>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 sm:px-3 sm:py-1.5">{getTranslation("onboarding.socialSection")}</span>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 sm:px-3 sm:py-1.5">{getTranslation("onboarding.contactSection")}</span>
              </div>
            </div>
            <ImportPreviewPlaceholder getTranslation={getTranslation} />
          </div>
        </div>
      )}

      {phase === "scanning" && <ScanningView stage={scanStage} getTranslation={getTranslation} />}

      {phase === "review" && (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ProfileReviewEditor
            profile={profile}
            importResult={importResult}
            logoFile={logoFile}
            primaryFile={primaryFile}
            hostedPreviewUrl={hostedPreviewUrl}
            slugEdited={slugEdited}
            loading={loading}
            error={error}
            isAdditionalRestaurant={isAdditionalRestaurant}
            getTranslation={getTranslation}
            onNameChange={updateName}
            onSlugChange={(value) => { setSlugEdited(true); setField("slug", value.toLowerCase()) }}
            onFieldChange={setField}
            onSocialChange={updateSocial}
            onImageChange={chooseImage}
            onPublish={() => void publish()}
            onPreview={() => void openPreview()}
            onBack={() => { setPhase("source"); setError("") }}
          />
          <OnboardingPhonePreview profile={profile} logoUrl={logoPreviewUrl} primaryImageUrl={primaryPreviewUrl} rootDomain={rootDomain} getTranslation={getTranslation} />
        </div>
      )}
      </div>
    </OnboardingShell>
  )
}

function ImportPreviewPlaceholder({ getTranslation }: { getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string }) {
  return (
    <aside className="relative overflow-hidden rounded-[2rem] border border-stone-200 bg-stone-950 p-6 text-white shadow-sm sm:p-8">
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between"><span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Reservevia</span><Sparkles className="h-5 w-5 text-amber-300" /></div>
        <div className="mt-12 rounded-[1.5rem] border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
          <div className="h-28 animate-pulse rounded-2xl bg-white/10" />
          <div className="mt-4 flex items-end gap-3"><div className="h-14 w-14 animate-pulse rounded-2xl bg-white/15" /><div className="flex-1 space-y-2"><div className="h-4 w-2/3 animate-pulse rounded-full bg-white/15" /><div className="h-3 w-1/2 animate-pulse rounded-full bg-white/10" /></div></div>
          <div className="mt-5 space-y-2"><div className="h-3 w-full animate-pulse rounded-full bg-white/10" /><div className="h-3 w-4/5 animate-pulse rounded-full bg-white/10" /></div>
        </div>
        <p className="mt-5 hidden text-sm leading-6 text-white/60 sm:block">{getTranslation("onboarding.importPreviewHint")}</p>
      </div>
    </aside>
  )
}

function ScanningView({ stage, getTranslation }: { stage: number; getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string }) {
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-8 rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm sm:p-10 lg:grid-cols-[0.7fr_1fr]">
      <div className="flex min-h-[270px] flex-col items-center justify-center rounded-[1.5rem] bg-stone-950 p-8 text-center text-white">
        <div className="relative flex h-24 w-24 items-center justify-center"><div className="absolute inset-0 animate-ping rounded-full bg-amber-300/20" /><div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/10"><Globe2 className="h-8 w-8 text-amber-300" /></div></div>
        <h2 className="mt-7 text-xl font-semibold">{getTranslation("onboarding.scanningTitle")}</h2>
        <p className="mt-2 max-w-xs text-sm leading-6 text-white/60">{getTranslation("onboarding.scanningDescription")}</p>
      </div>
      <div>
        <div className="flex items-center justify-between"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">{getTranslation("onboarding.scanningKicker")}</p><span className="text-sm font-medium text-stone-500">{Math.min(stage + 1, SCAN_STAGES.length)}/{SCAN_STAGES.length}</span></div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-stone-950 transition-all duration-700" style={{ width: `${Math.min(((stage + 1) / SCAN_STAGES.length) * 100, 96)}%` }} /></div>
        <div className="mt-7 space-y-3" aria-live="polite">{SCAN_STAGES.map((key, index) => { const active = index === stage; const complete = index < stage; return <div key={key} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all duration-500 ${active ? "border-stone-300 bg-stone-50 text-stone-950" : complete ? "border-emerald-100 bg-emerald-50/60 text-emerald-800" : "border-stone-100 text-stone-400"}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${complete ? "bg-emerald-100" : active ? "bg-stone-950 text-white" : "bg-stone-100"}`}>{complete ? <Check className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-xs font-semibold">{index + 1}</span>}</span><span className="text-sm font-medium">{getTranslation(key)}</span>{active && <span className="ml-auto text-xs text-stone-400">{getTranslation("onboarding.scanningNow")}</span>}</div> })}</div>
      </div>
    </section>
  )
}

function ProfileReviewEditor({
  profile,
  importResult,
  logoFile,
  primaryFile,
  hostedPreviewUrl,
  slugEdited,
  loading,
  error,
  isAdditionalRestaurant,
  getTranslation,
  onNameChange,
  onSlugChange,
  onFieldChange,
  onSocialChange,
  onImageChange,
  onPublish,
  onPreview,
  onBack,
}: {
  profile: RestaurantProfileInput
  importResult: WebsiteImportResult | null
  logoFile: File | null
  primaryFile: File | null
  hostedPreviewUrl: string
  slugEdited: boolean
  loading: boolean
  error: string
  isAdditionalRestaurant: boolean
  getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string
  onNameChange: (value: string) => void
  onSlugChange: (value: string) => void
  onFieldChange: <K extends keyof RestaurantProfileInput>(field: K, value: RestaurantProfileInput[K]) => void
  onSocialChange: (platform: SocialPlatform, value: string) => void
  onImageChange: (kind: "logo" | "primary", file: File | undefined) => void
  onPublish: () => void
  onPreview: () => void
  onBack: () => void
}) {
  const missingCount = importResult?.missingFields.length || 0
  const sourceField = (key: keyof WebsiteImportResult["profile"]) => importResult?.fields[key]
  const [aiDetailsOpen, setAiDetailsOpen] = useState(false)
  const [socialDetailsOpen, setSocialDetailsOpen] = useState(false)
  const socialPlatforms = SOCIAL_PLATFORMS.filter((platform) => platform !== "website")
  const populatedSocialPlatforms = socialPlatforms.filter((platform) => Boolean(profile.social_links?.[platform]))
  const visibleSocialPlatforms = socialDetailsOpen ? socialPlatforms : populatedSocialPlatforms
  const socialSummary = populatedSocialPlatforms.length
    ? `${populatedSocialPlatforms.length} profile${populatedSocialPlatforms.length === 1 ? "" : "s"} added`
    : "No profiles added yet"

  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
      <button type="button" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 transition hover:text-stone-950" onClick={onBack} disabled={loading}><ArrowLeft className="h-3.5 w-3.5" /> {getTranslation("common.back")}</button>
      <div className="flex flex-col gap-4 border-b border-stone-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">{getTranslation("onboarding.reviewKicker")}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{getTranslation("onboarding.reviewTitle")}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-stone-600">{getTranslation("onboarding.reviewDescription")}</p></div>
        {importResult && <div className="shrink-0 rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"><CheckCircle2 className="mr-1 inline h-4 w-4" /> {getTranslation("onboarding.importedPages", { count: importResult.crawledPages })}</div>}
      </div>

      {importResult && <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm text-amber-900"><Sparkles className="h-4 w-4 shrink-0" /><span>{missingCount ? getTranslation("onboarding.missingFields", { count: missingCount }) : getTranslation("onboarding.allFieldsFound")}</span>{importResult.sourceUrl && <a href={importResult.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium underline underline-offset-2">{getTranslation("onboarding.viewSource")} <ExternalLink className="h-3.5 w-3.5" /></a>}</div>}

      <div className="mt-7 space-y-8">
        <div>
          <SectionHeading icon={<Sparkles className="h-4 w-4" />} title={getTranslation("onboarding.identitySection")} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={getTranslation("onboarding.name")} source={sourceField("name")} getTranslation={getTranslation}><Input aria-label={getTranslation("onboarding.name")} value={profile.name} onChange={(event) => onNameChange(event.target.value)} className="h-11 rounded-xl" /></Field>
            <Field label={getTranslation("onboarding.publicAddress")} source={null} getTranslation={getTranslation}><Input value={profile.slug || ""} onChange={(event) => onSlugChange(event.target.value)} className="h-11 rounded-xl" /><p className="mt-1.5 text-xs text-stone-500">{hostedPreviewUrl}{slugEdited ? "" : ` · ${getTranslation("onboarding.autoGenerated")}`}</p></Field>
          </div>
        </div>

        <div>
          <SectionHeading icon={<ImagePlus className="h-4 w-4" />} title={getTranslation("onboarding.visualSection")} />
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <AssetCandidates kind="logo" label={getTranslation("onboarding.logo")} selectedUrl={profile.logo_url || null} file={logoFile} candidates={importResult?.logoCandidates || []} onSelect={(url) => onFieldChange("logo_url", url)} onChange={(file) => onImageChange("logo", file)} getTranslation={getTranslation} />
            <AssetCandidates kind="banner" label={getTranslation("onboarding.primaryImage")} selectedUrl={profile.primary_image_url || null} file={primaryFile} candidates={importResult?.bannerCandidates || []} onSelect={(url) => onFieldChange("primary_image_url", url)} onChange={(file) => onImageChange("primary", file)} getTranslation={getTranslation} />
          </div>
        </div>

        <div>
          <SectionHeading icon={<Utensils className="h-4 w-4" />} title={getTranslation("onboarding.storySection")} />
          <div className="mt-4 space-y-4">
            <Field label={getTranslation("onboarding.description")} source={sourceField("description")} getTranslation={getTranslation}><Textarea value={profile.description || ""} onChange={(event) => onFieldChange("description", event.target.value)} rows={4} maxLength={600} className="rounded-xl" placeholder={getTranslation("onboarding.descriptionPlaceholder")} /></Field>
            <div className="grid gap-4 sm:grid-cols-3"><Field label={getTranslation("onboarding.cuisine")} source={sourceField("cuisine")} getTranslation={getTranslation}><Input value={profile.cuisine || ""} onChange={(event) => onFieldChange("cuisine", event.target.value)} className="h-11 rounded-xl" /></Field><Field label={getTranslation("onboarding.atmosphere")} source={sourceField("atmosphere")} getTranslation={getTranslation}><Input value={profile.atmosphere || ""} onChange={(event) => onFieldChange("atmosphere", event.target.value)} className="h-11 rounded-xl" /></Field><Field label={getTranslation("onboarding.openingHours")} source={sourceField("hours")} getTranslation={getTranslation}><Input value={profile.hours || ""} onChange={(event) => onFieldChange("hours", event.target.value)} className="h-11 rounded-xl" placeholder="12:00–22:00" /></Field></div>
          </div>
        </div>

        <div>
          <SectionHeading icon={<Phone className="h-4 w-4" />} title={getTranslation("onboarding.contactSection")} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label={getTranslation("onboarding.phone")} source={sourceField("phone")} getTranslation={getTranslation}><Input type="tel" value={profile.phone || ""} onChange={(event) => onFieldChange("phone", event.target.value)} className="h-11 rounded-xl" /></Field><Field label={getTranslation("onboarding.locationAddress")} source={sourceField("location")} getTranslation={getTranslation}><Input value={profile.location || ""} onChange={(event) => onFieldChange("location", event.target.value)} className="h-11 rounded-xl" /></Field></div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3"><Field label={getTranslation("onboarding.menuUrl")} source={sourceField("menu_url")} getTranslation={getTranslation}><Input type="url" value={profile.menu_url || ""} onChange={(event) => onFieldChange("menu_url", event.target.value)} className="h-11 rounded-xl" placeholder="https://…" /></Field><Field label={getTranslation("onboarding.locationUrl")} source={sourceField("location_url")} getTranslation={getTranslation}><Input type="url" value={profile.location_url || ""} onChange={(event) => onFieldChange("location_url", event.target.value)} className="h-11 rounded-xl" placeholder="https://maps…" /></Field><Field label={getTranslation("onboarding.eventsUrl")} source={sourceField("events_url")} getTranslation={getTranslation}><Input type="url" value={profile.events_url || ""} onChange={(event) => onFieldChange("events_url", event.target.value)} className="h-11 rounded-xl" placeholder="https://…" /></Field></div>
        </div>

        <RestaurantAiReadiness
          compact
          restaurant={{ id: "pending", slug: profile.slug || null, name: profile.name || null, location: profile.location, address_line1: profile.address_line1, address_line2: profile.address_line2, address_locality: profile.address_locality, address_region: profile.address_region, address_postal_code: profile.address_postal_code, address_country: profile.address_country, latitude: profile.latitude, longitude: profile.longitude, phone: profile.phone, official_website_url: profile.official_website_url, timezone: profile.timezone, status: "published", platform_status: "active", reservation_enabled: true }}
          canonicalUrl={hostedPreviewUrl}
          details={{
            label: "AI & search details",
            summary: "Review only the fields the scan could not verify",
            open: aiDetailsOpen,
            onOpenChange: setAiDetailsOpen,
            children: (
              <div className="space-y-3">
                <p className="text-[11px] leading-4 text-slate-600">Most values are filled from the official website.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["address_line1", "address_line2", "address_locality", "address_region", "address_postal_code", "address_country"] as const).map((field) => <Field key={field} label={field.replace("address_", "").replaceAll("_", " ")} source={sourceField(field)} getTranslation={getTranslation}><Input value={profile[field] || ""} onChange={(event) => onFieldChange(field, event.target.value || null)} className="h-10 rounded-lg bg-white/70 text-sm" /></Field>)}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Latitude" source={sourceField("latitude")} getTranslation={getTranslation}><Input type="number" step="any" min="-90" max="90" value={profile.latitude ?? ""} onChange={(event) => onFieldChange("latitude", event.target.value === "" ? null : Number(event.target.value))} className="h-10 rounded-lg bg-white/70 text-sm" /></Field>
                  <Field label="Longitude" source={sourceField("longitude")} getTranslation={getTranslation}><Input type="number" step="any" min="-180" max="180" value={profile.longitude ?? ""} onChange={(event) => onFieldChange("longitude", event.target.value === "" ? null : Number(event.target.value))} className="h-10 rounded-lg bg-white/70 text-sm" /></Field>
                  <Field label="Official website" source={sourceField("official_website_url")} getTranslation={getTranslation}><Input type="url" value={profile.official_website_url || ""} onChange={(event) => onFieldChange("official_website_url", event.target.value || null)} className="h-10 rounded-lg bg-white/70 text-sm" placeholder="https://…" /></Field>
                </div>
              </div>
            ),
          }}
        />

        <div className="rounded-2xl border border-stone-200 bg-stone-50/60 p-3 sm:p-4">
          <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setSocialDetailsOpen((open) => !open)} aria-expanded={socialDetailsOpen}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-stone-600 shadow-sm"><Globe2 className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-stone-900">{getTranslation("onboarding.socialSection")}</span><span className="mt-0.5 block truncate text-[11px] text-stone-500">{socialSummary}</span></span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-stone-500 transition-transform ${socialDetailsOpen ? "rotate-180" : ""}`} />
          </button>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{visibleSocialPlatforms.map((platform) => <Field key={platform} label={SOCIAL_LABELS[platform]} source={importResult?.fields.social_links} getTranslation={getTranslation}><div className="relative"><SocialIcon platform={platform} className="absolute left-3 top-1/2 -translate-y-1/2" /><Input type="url" value={profile.social_links?.[platform] || ""} onChange={(event) => onSocialChange(platform, event.target.value)} className="h-10 rounded-lg bg-white pl-10 text-sm" placeholder={`https://${platform}.com/…`} /></div></Field>)}</div>
          {!visibleSocialPlatforms.length ? <p className="mt-3 text-[11px] leading-4 text-stone-500">Expand to add social profiles found outside the scan.</p> : null}
        </div>
      </div>

      {error && <Alert variant="destructive" className="mt-8 animate-in slide-in-from-bottom-2 fade-in duration-300"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="mt-4 flex flex-col gap-3 border-t border-stone-100 pt-6 sm:flex-row sm:items-center sm:justify-end"><div className="flex flex-col gap-3 sm:flex-row"><Button type="button" variant="outline" className="h-12 rounded-xl" loading={loading} disabled={loading} onClick={onPreview}><ExternalLink className="h-4 w-4" /> {getTranslation("onboarding.previewPage")}</Button><Button type="button" className="h-12 rounded-xl bg-stone-950 text-white hover:bg-stone-800 sm:min-w-[210px]" loading={loading} onClick={onPublish}>{loading ? getTranslation("onboarding.publishing") : <>{getTranslation("onboarding.saveAndPublish")} <ArrowRight className="h-4 w-4" /></>}</Button></div></div>
      <p className="mt-3 text-right text-xs leading-5 text-stone-500">{getTranslation(isAdditionalRestaurant ? "onboarding.additionalPublishNote" : "onboarding.initialPublishNote")}</p>
    </section>
  )
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="flex items-center gap-2 text-sm font-semibold text-stone-900"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-stone-100 text-stone-600">{icon}</span>{title}</div>
}

function Field({ label, source, getTranslation, children }: { label: string; source: { source: string; confidence: "high" | "medium" | "low" } | null | undefined; getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string; children: React.ReactNode }) {
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2"><Label className="text-stone-700">{label}</Label>{source && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" /> {getTranslation("onboarding.foundOnWebsite")}</span>}</div>{children}</div>
}

function AssetCandidates({ kind, label, selectedUrl, file, candidates, onSelect, onChange, getTranslation }: { kind: "logo" | "banner"; label: string; selectedUrl: string | null; file: File | null; candidates: WebsiteImportResult["logoCandidates"]; onSelect: (url: string) => void; onChange: (file: File | undefined) => void; getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string }) {
  const filePreview = useObjectUrl(file)
  const options = selectedUrl && !candidates.some((candidate) => candidate.url === selectedUrl)
    ? [{ url: selectedUrl, kind, label: getTranslation("onboarding.currentImage"), source: "Current profile" }, ...candidates]
    : candidates
  return <div className="space-y-3"><div className="flex items-center justify-between"><Label className="text-stone-700">{label}</Label><span className="text-[11px] text-stone-400">{getTranslation("onboarding.chooseOrUpload")}</span></div><div className="grid grid-cols-3 gap-2">{options.length ? options.slice(0, 3).map((candidate) => <button key={candidate.url} type="button" onClick={() => onSelect(candidate.url)} className={`group relative overflow-hidden rounded-xl border bg-stone-50 text-left transition hover:border-stone-400 ${selectedUrl === candidate.url && !file ? "border-stone-950 ring-2 ring-stone-950/10" : "border-stone-200"}`}><div className={`${kind === "logo" ? "aspect-square" : "aspect-[1.6/1]"} overflow-hidden`}><img src={candidate.url} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" /></div>{selectedUrl === candidate.url && !file && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-stone-950 text-white"><Check className="h-3 w-3" /></span>}<span className="block truncate px-2 py-1.5 text-[10px] text-stone-500">{candidate.label}</span></button>) : <div className="col-span-3 rounded-xl border border-dashed border-stone-200 px-3 py-5 text-center text-xs text-stone-400">{getTranslation("onboarding.noImageFound")}</div>}<label htmlFor={`onboarding-${kind}-upload`} className={`group relative flex cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-stone-300 bg-stone-50 transition hover:border-stone-500 hover:bg-stone-100 ${kind === "logo" ? "aspect-square" : "aspect-[1.6/1]"}`}>{filePreview ? <img src={filePreview} alt={getTranslation("onboarding.imageAlt", { label })} className="h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-center text-xs font-medium text-stone-500"><ImagePlus className="h-5 w-5" />{getTranslation("onboarding.uploadImage")}</span>}<input id={`onboarding-${kind}-upload`} type="file" accept="image/*" className="sr-only" onChange={(event) => { onChange(event.target.files?.[0]); event.currentTarget.value = "" }} /></label></div><p className="text-xs text-stone-500">{file ? file.name : getTranslation("onboarding.imageLimit")}</p></div>
}

function SocialIcon({ platform, className = "" }: { platform: SocialPlatform; className?: string }) {
  if (platform === "instagram") return <Instagram className={`h-4 w-4 text-pink-500 ${className}`} />
  if (platform === "facebook") return <Facebook className={`h-4 w-4 text-blue-600 ${className}`} />
  if (platform === "tiktok") return <Music2 className={`h-4 w-4 text-stone-950 ${className}`} />
  if (platform === "youtube") return <Youtube className={`h-4 w-4 text-red-500 ${className}`} />
  if (platform === "x") return <Twitter className={`h-4 w-4 text-stone-950 ${className}`} />
  return <Globe2 className={`h-4 w-4 text-stone-400 ${className}`} />
}

function OnboardingPhonePreview({ profile, logoUrl, primaryImageUrl, rootDomain, getTranslation }: { profile: RestaurantProfileInput; logoUrl: string | null; primaryImageUrl: string | null; rootDomain: string; getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string }) {
  const name = profile.name || getTranslation("onboarding.yourRestaurant")
  const socialLinks = normalizeSocialLinks(profile.social_links)
  const socialPlatforms = SOCIAL_PLATFORMS.filter((platform) => platform !== "website" && socialLinks[platform])
  return <aside className="order-first lg:sticky lg:top-8 lg:order-last"><div className="rounded-[2rem] border border-stone-200 bg-[#ece8e1] p-4 shadow-sm sm:p-6"><div className="mb-4 flex items-center justify-between px-1"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">{getTranslation("onboarding.livePreview")}</p><p className="mt-1 text-xs text-stone-500">{getTranslation("onboarding.previewUpdates")}</p></div><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-stone-700 shadow-sm"><Pencil className="h-3.5 w-3.5" /></div></div><div className="overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-xl"><div className="relative aspect-[1.7/1] overflow-hidden bg-stone-100">{primaryImageUrl ? <img src={primaryImageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-stone-400"><ImagePlus className="h-8 w-8" /></div>}{logoUrl && <img src={logoUrl} alt="" className="absolute bottom-3 left-3 h-12 w-12 rounded-2xl border-2 border-white/90 bg-white object-contain p-1 shadow-lg" />}</div><div className="p-4"><h2 className="truncate text-lg font-semibold text-stone-950">{name}</h2><div className="mt-1 flex items-center gap-2 text-[11px] text-stone-500">{profile.cuisine && <span>{profile.cuisine}</span>}{profile.cuisine && profile.atmosphere && <span>·</span>}{profile.atmosphere && <span>{profile.atmosphere}</span>}</div>{profile.description ? <p className="mt-3 line-clamp-4 text-xs leading-5 text-stone-600">{profile.description}</p> : <p className="mt-3 text-xs italic leading-5 text-stone-400">{getTranslation("onboarding.guestDescriptionPlaceholder")}</p>}<div className="mt-4 grid gap-2 text-[11px] text-stone-600">{profile.hours && <div className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-stone-400" />{profile.hours}</div>}{profile.location && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-stone-400" />{profile.location}</div>}{profile.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-stone-400" />{profile.phone}</div>}</div>{socialPlatforms.length > 0 && <div className="mt-4 flex items-center gap-2">{socialPlatforms.map((platform) => <span key={platform} className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-100 text-stone-500"><SocialIcon platform={platform} /></span>)}</div>}<div className="mt-5 flex h-10 items-center justify-between rounded-xl bg-stone-950 px-3 text-xs font-semibold text-white"><span>{getTranslation("onboarding.previewReserve")}</span><ArrowRight className="h-3.5 w-3.5" /></div></div></div><p className="mt-4 text-center text-[11px] leading-4 text-stone-500">{getTranslation("onboarding.previewUpdates")}<br /><span className="font-medium text-stone-700">{profile.slug || "your-restaurant"}.{rootDomain}</span></p></div></aside>
}
