"use client"

import Link from "next/link"
import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Facebook,
  Globe2,
  Eye,
  ImagePlus,
  Instagram,
  Layers3,
  Link2,
  MapPin,
  MessageCircle,
  Music2,
  Phone,
  Save,
  Twitter,
  Utensils,
  Youtube,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { getReservationAreas, bulkUpdateReservationAreas } from "@/app/manage/reservation-areas-actions"
import { updateRestaurant, updateRestaurantProfile } from "@/app/manage/actions"
import type { Restaurant } from "@/types/supabase"
import { useLanguage } from "@/context/language-context"
import {
  normalizeProfileVisibility,
  normalizeSocialLinks,
  type RestaurantProfileVisibilityKey,
  type RestaurantSocialLinks,
  type SocialPlatform,
} from "@/lib/restaurant-profile"
import {
  ReservationAreasForm,
  type ReservationAreaFormData,
} from "@/components/manage/reservation-areas-form"
import { RestaurantAiReadiness } from "@/components/restaurant-ai-readiness"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])

type EditorTab = "profile" | "reservations" | "areas"

type ProfileFormState = {
  name: string
  slug: string
  logo_url: string
  primary_image_url: string
  description: string
  cuisine: string
  atmosphere: string
  hours: string
  location: string
  phone: string
  whatsapp: string
  menu_url: string
  location_url: string
  events_url: string
  social_links: RestaurantSocialLinks
  profile_visibility: Record<RestaurantProfileVisibilityKey, boolean>
  timezone: string
  language: string
  address_line1: string
  address_line2: string
  address_locality: string
  address_region: string
  address_postal_code: string
  address_country: string
  latitude: number | null
  longitude: number | null
  official_website_url: string
  status: "published" | "unpublished"
}

type ReservationFormState = {
  reservation_enabled: boolean
  meal_only_reservations: boolean
  allowed_days_of_week: number[]
  opening_time: string
  closing_time: string
  time_slot_duration: number
  advance_booking_days: number
  min_advance_hours: number
  min_party_size: number
  max_party_size: number
  reservation_start_date: string
}

const visibilityLabelKeys: Record<RestaurantProfileVisibilityKey, string> = {
  logo: "manage.restaurantForm.visibility.logo",
  banner: "manage.restaurantForm.visibility.banner",
  description: "manage.restaurantForm.visibility.description",
  cuisine: "manage.restaurantForm.visibility.cuisine",
  hours: "manage.restaurantForm.visibility.hours",
  atmosphere: "manage.restaurantForm.visibility.atmosphere",
  phone: "manage.restaurantForm.visibility.phone",
  whatsapp: "manage.restaurantForm.visibility.whatsapp",
  location: "manage.restaurantForm.visibility.location",
  menu: "manage.restaurantForm.visibility.menu",
  events: "manage.restaurantForm.visibility.events",
  social: "manage.restaurantForm.visibility.social",
  reserve: "manage.restaurantForm.visibility.reserve",
}

const PREVIEW_SOCIAL_PLATFORMS: ReadonlyArray<{ platform: SocialPlatform; label: string; Icon: LucideIcon }> = [
  { platform: "instagram", label: "Instagram", Icon: Instagram },
  { platform: "facebook", label: "Facebook", Icon: Facebook },
  { platform: "tiktok", label: "TikTok", Icon: Music2 },
  { platform: "youtube", label: "YouTube", Icon: Youtube },
  { platform: "x", label: "X", Icon: Twitter },
  { platform: "website", label: "Website", Icon: Globe2 },
]

const EDIT_SOCIAL_FIELDS: ReadonlyArray<{ platform: SocialPlatform; id: string; labelKey: string; placeholder: string }> = [
  { platform: "instagram", id: "profile-instagram", labelKey: "marketing.instagramLink", placeholder: "https://instagram.com/…" },
  { platform: "facebook", id: "profile-facebook", labelKey: "marketing.facebookLink", placeholder: "https://facebook.com/…" },
  { platform: "tiktok", id: "profile-tiktok", labelKey: "marketing.tiktokLink", placeholder: "https://tiktok.com/@…" },
  { platform: "youtube", id: "profile-youtube", labelKey: "marketing.youtubeLink", placeholder: "https://youtube.com/@…" },
  { platform: "x", id: "profile-x", labelKey: "marketing.xLink", placeholder: "https://x.com/…" },
  { platform: "website", id: "profile-website", labelKey: "marketing.websiteLink", placeholder: "https://…" },
]

const dayLabelKeys: ReadonlyArray<{ value: number; key: string }> = [
  { value: 1, key: "manage.restaurantForm.days.monday" },
  { value: 2, key: "manage.restaurantForm.days.tuesday" },
  { value: 3, key: "manage.restaurantForm.days.wednesday" },
  { value: 4, key: "manage.restaurantForm.days.thursday" },
  { value: 5, key: "manage.restaurantForm.days.friday" },
  { value: 6, key: "manage.restaurantForm.days.saturday" },
  { value: 7, key: "manage.restaurantForm.days.sunday" },
]

function isHttpUrl(value: string | null | undefined) {
  if (!value?.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function getInitialState(restaurant: Restaurant): ProfileFormState {
  const legacyLocationUrl = !restaurant.location_url && isHttpUrl(restaurant.location) ? restaurant.location : ""
  return {
    name: restaurant.name,
    slug: restaurant.slug,
    logo_url: getSafeRestaurantAssetUrl(restaurant.logo_url) || "",
    primary_image_url: getSafeRestaurantAssetUrl(restaurant.primary_image_url) || "",
    description: restaurant.description || "",
    cuisine: restaurant.cuisine || "",
    atmosphere: restaurant.atmosphere || "",
    hours: restaurant.hours || "",
    location: legacyLocationUrl ? "" : restaurant.location || "",
    phone: restaurant.phone || "",
    whatsapp: restaurant.whatsapp || "",
    menu_url: restaurant.menu_url || "",
    location_url: restaurant.location_url || legacyLocationUrl || "",
    events_url: restaurant.events_url || "",
    social_links: normalizeSocialLinks(restaurant.social_links),
    profile_visibility: {
      ...normalizeProfileVisibility(restaurant.profile_visibility),
      logo: true,
      banner: true,
    },
    timezone: restaurant.timezone || "UTC",
    language: restaurant.language || "en",
    address_line1: restaurant.address_line1 || "",
    address_line2: restaurant.address_line2 || "",
    address_locality: restaurant.address_locality || "",
    address_region: restaurant.address_region || "",
    address_postal_code: restaurant.address_postal_code || "",
    address_country: restaurant.address_country || "",
    latitude: restaurant.latitude ?? null,
    longitude: restaurant.longitude ?? null,
    official_website_url: restaurant.official_website_url || normalizeSocialLinks(restaurant.social_links).website || "",
    status: restaurant.status === "unpublished" ? "unpublished" : "published",
  }
}

function getInitialReservationState(restaurant: Restaurant): ReservationFormState {
  return {
    reservation_enabled: restaurant.reservation_enabled ?? true,
    meal_only_reservations: restaurant.meal_only_reservations ?? false,
    allowed_days_of_week: restaurant.allowed_days_of_week || [1, 2, 3, 4, 5, 6, 7],
    opening_time: restaurant.opening_time || "09:00",
    closing_time: restaurant.closing_time || "22:00",
    time_slot_duration: restaurant.time_slot_duration || 30,
    advance_booking_days: restaurant.advance_booking_days || 30,
    min_advance_hours: restaurant.min_advance_hours || 2,
    min_party_size: restaurant.min_party_size || 1,
    max_party_size: restaurant.max_party_size || 12,
    reservation_start_date: restaurant.reservation_start_date || "",
  }
}

function validateImage(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return "type"
  if (file.size > MAX_IMAGE_SIZE) return "size"
  return null
}

function storagePathFromPublicUrl(url: string) {
  const marker = "/storage/v1/object/public/restaurant-assets/"
  const markerIndex = url.indexOf(marker)
  return markerIndex >= 0 ? decodeURIComponent(url.slice(markerIndex + marker.length)) : null
}

function safeFileName(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "image"
  return `${crypto.randomUUID()}.${extension}`
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

export function RestaurantProfileForm({ restaurant, rootDomain }: { restaurant: Restaurant; rootDomain: string }) {
  const { getTranslation, translateMessage } = useLanguage()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<EditorTab>("profile")
  const [form, setForm] = useState<ProfileFormState>(() => getInitialState(restaurant))
  const [reservation, setReservation] = useState<ReservationFormState>(() => getInitialReservationState(restaurant))
  const [areas, setAreas] = useState<ReservationAreaFormData[]>([])
  const [areasLoaded, setAreasLoaded] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [primaryFile, setPrimaryFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingAreas, setIsLoadingAreas] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const loadAreas = useCallback(async () => {
    setIsLoadingAreas(true)
    const result = await getReservationAreas(restaurant.id)
    if (result.success) {
      setAreas(result.data.map((area) => ({
        id: area.id,
        name: area.name,
        description: area.description || "",
        is_active: area.is_active,
        display_order: area.display_order,
        opening_time: area.opening_time || reservation.opening_time,
        closing_time: area.closing_time || reservation.closing_time,
        time_slot_duration: area.time_slot_duration,
        max_party_size: area.max_party_size,
        min_party_size: area.min_party_size,
        advance_booking_days: area.advance_booking_days,
        min_advance_hours: area.min_advance_hours,
        allowed_days_of_week: area.allowed_days_of_week,
        blocked_dates: area.blocked_dates || [],
        max_concurrent_reservations: area.max_concurrent_reservations,
        useRestaurantDefaults: (
          area.opening_time === null &&
          area.closing_time === null &&
          area.time_slot_duration === null &&
          area.max_party_size === null &&
          area.min_party_size === null &&
          area.advance_booking_days === null &&
          area.min_advance_hours === null &&
          area.allowed_days_of_week === null
        ),
      })))
    } else {
      toast.error(translateMessage(result.message || getTranslation("onboarding.saveError")))
    }
    setAreasLoaded(true)
    setIsLoadingAreas(false)
  }, [getTranslation, reservation.closing_time, reservation.opening_time, restaurant.id, translateMessage])

  useEffect(() => {
    void loadAreas()
  }, [loadAreas])

  const setField = <K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const setVisibility = (field: RestaurantProfileVisibilityKey, value: boolean) => {
    setForm((current) => ({
      ...current,
      profile_visibility: { ...current.profile_visibility, [field]: value },
    }))
  }

  const setSocialLink = (platform: SocialPlatform, value: string) => {
    setForm((current) => ({
      ...current,
      social_links: { ...current.social_links, [platform]: value },
    }))
  }

  const selectImage = (kind: "logo" | "primary", file: File | undefined) => {
    if (!file) return
    const error = validateImage(file)
    if (error) {
      toast.error(error === "size" ? getTranslation("onboarding.fileErrorSize") : getTranslation("onboarding.fileErrorType"))
      return
    }
    if (kind === "logo") setLogoFile(file)
    else setPrimaryFile(file)
  }

  const uploadAsset = async (kind: "logo" | "primary", file: File) => {
    if (!restaurant.workspace_id) throw new Error("This restaurant has no workspace owner.")
    const supabase = getSupabaseBrowserClient()
    const path = `${restaurant.workspace_id}/${restaurant.id}/${kind}/${safeFileName(file)}`
    const { error } = await supabase.storage
      .from("restaurant-assets")
      .upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false })
    if (error) throw new Error(error.message)
    return supabase.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSaving(true)
    const uploadedPaths: string[] = []

    try {
      let logoUrl = form.logo_url
      let primaryImageUrl = form.primary_image_url
      if (logoFile) {
        logoUrl = await uploadAsset("logo", logoFile)
        uploadedPaths.push(storagePathFromPublicUrl(logoUrl) || "")
      }
      if (primaryFile) {
        primaryImageUrl = await uploadAsset("primary", primaryFile)
        uploadedPaths.push(storagePathFromPublicUrl(primaryImageUrl) || "")
      }

      const profileResult = await updateRestaurantProfile(restaurant.id, {
        ...form,
        logo_url: logoUrl || null,
        primary_image_url: primaryImageUrl || null,
      })
      if (!profileResult.success) {
        const supabase = getSupabaseBrowserClient()
        if (uploadedPaths.filter(Boolean).length) await supabase.storage.from("restaurant-assets").remove(uploadedPaths.filter(Boolean))
        if ("suggestedSlug" in profileResult && profileResult.suggestedSlug) {
          setField("slug", profileResult.suggestedSlug)
        }
        toast.error(translateMessage(profileResult.message || getTranslation("onboarding.saveError")))
        return
      }

      const reservationResult = await updateRestaurant(restaurant.id, reservation)
      if (!reservationResult.success) {
        toast.error(translateMessage(reservationResult.message || getTranslation("onboarding.saveError")))
        return
      }

      if (areasLoaded) {
        const areasResult = await bulkUpdateReservationAreas(restaurant.id, areas.map((area) => ({
          id: area.id,
          restaurant_id: restaurant.id,
          name: area.name.trim(),
          description: area.description.trim(),
          is_active: area.is_active,
          display_order: area.display_order,
          opening_time: area.useRestaurantDefaults ? undefined : area.opening_time,
          closing_time: area.useRestaurantDefaults ? undefined : area.closing_time,
          time_slot_duration: area.useRestaurantDefaults ? undefined : area.time_slot_duration ?? undefined,
          max_party_size: area.useRestaurantDefaults ? undefined : area.max_party_size ?? undefined,
          min_party_size: area.useRestaurantDefaults ? undefined : area.min_party_size ?? undefined,
          advance_booking_days: area.useRestaurantDefaults ? undefined : area.advance_booking_days ?? undefined,
          min_advance_hours: area.useRestaurantDefaults ? undefined : area.min_advance_hours ?? undefined,
          allowed_days_of_week: area.useRestaurantDefaults ? undefined : area.allowed_days_of_week ?? undefined,
          blocked_dates: area.blocked_dates || [],
          max_concurrent_reservations: area.max_concurrent_reservations ?? undefined,
        })))
        if (!areasResult.success) {
          toast.error(translateMessage(areasResult.message || getTranslation("manage.errors.areasUpdateFailed")))
          return
        }
      }

      const supabase = getSupabaseBrowserClient()
      const replacedPaths = [
        logoFile ? storagePathFromPublicUrl(restaurant.logo_url || "") : null,
        primaryFile ? storagePathFromPublicUrl(restaurant.primary_image_url || "") : null,
      ].filter((path): path is string => Boolean(path))
      if (replacedPaths.length) await supabase.storage.from("restaurant-assets").remove(replacedPaths)

      toast.success(translateMessage(profileResult.message || getTranslation("manage.errors.profileUpdated")))
      router.refresh()
      setLogoFile(null)
      setPrimaryFile(null)
    } catch (error) {
      toast.error(error instanceof Error ? translateMessage(error.message) : getTranslation("onboarding.saveError"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="restaurant-profile-editor mx-auto w-full max-w-6xl space-y-3 pb-6 sm:space-y-4 sm:pb-8">
      <header className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-200/80 bg-white/90 px-3.5 py-3 shadow-sm shadow-slate-900/[0.03] backdrop-blur sm:px-5 sm:py-3.5">
        <div className="min-w-0">
          <Link href="/manage/restaurants" className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-900">
            <ArrowLeft className="h-3.5 w-3.5" /> {getTranslation("manage.restaurants.title")}
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-950 sm:text-xl">{form.name || getTranslation("marketing.editRestaurant")}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${form.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {form.status === "published" ? getTranslation("manage.restaurants.published") : getTranslation("manage.restaurants.unpublished")}
            </span>
          </div>
          <p className="mt-0.5 hidden text-xs text-slate-500 sm:block">{getTranslation("marketing.updateBasics")}</p>
        </div>
        <Button type="submit" loading={isSaving} className="h-9 shrink-0 gap-2 rounded-xl bg-slate-900 px-3.5 text-xs font-semibold text-white shadow-sm shadow-slate-900/15 hover:bg-slate-800 sm:px-4 sm:text-sm">
          <Save className="h-4 w-4" /> {isSaving ? getTranslation("onboarding.saving") : getTranslation("marketing.saveChanges")}
        </Button>
      </header>

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-4">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-900/[0.03]">
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50/80 p-1" aria-label={getTranslation("manage.restaurantForm.settingsAria" as never)}>
            <TabButton active={activeTab === "profile"} onClick={() => setActiveTab("profile")} icon={<Eye className="h-4 w-4" />}>{getTranslation("manage.restaurantForm.details")}</TabButton>
            <TabButton active={activeTab === "reservations"} onClick={() => setActiveTab("reservations")} icon={<CalendarDays className="h-4 w-4" />}>{getTranslation("manage.restaurantForm.reservations")}</TabButton>
            <TabButton active={activeTab === "areas"} onClick={() => setActiveTab("areas")} icon={<Layers3 className="h-4 w-4" />}>{getTranslation("manage.restaurantForm.areas")}</TabButton>
          </nav>

          <div className="p-3.5 sm:p-5">
            {activeTab === "profile" && (
              <ProfileTab
                form={form}
                restaurant={restaurant}
                reservation={reservation}
                rootDomain={rootDomain}
                logoFile={logoFile}
                primaryFile={primaryFile}
                showAdvanced={showAdvanced}
                getTranslation={getTranslation}
                setField={setField}
                setVisibility={setVisibility}
                setSocialLink={setSocialLink}
                setShowAdvanced={setShowAdvanced}
                selectImage={selectImage}
              />
            )}

            {activeTab === "reservations" && (
              <ReservationTab
                reservation={reservation}
                getTranslation={getTranslation}
                setReservation={setReservation}
              />
            )}

            {activeTab === "areas" && (
              <div className="space-y-4">
                {isLoadingAreas ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                    {getTranslation("common.loading")}
                  </div>
                ) : (
                  <ReservationAreasForm restaurant={restaurant} areas={areas} onAreasChange={setAreas} />
                )}
              </div>
            )}
          </div>
        </div>

        <ProfilePreview form={form} reservation={reservation} getTranslation={getTranslation} />
      </div>
    </form>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={`inline-flex min-w-max items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:text-sm ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:bg-white/70 hover:text-slate-800"}`}
    >
      {icon}
      {children}
    </button>
  )
}

function ProfileTab({
  form,
  restaurant,
  reservation,
  rootDomain,
  logoFile,
  primaryFile,
  showAdvanced,
  getTranslation,
  setField,
  setVisibility,
  setSocialLink,
  setShowAdvanced,
  selectImage,
}: {
  form: ProfileFormState
  restaurant: Restaurant
  reservation: ReservationFormState
  rootDomain: string
  logoFile: File | null
  primaryFile: File | null
  showAdvanced: boolean
  getTranslation: (key: never, variables?: Record<string, string | number>) => string
  setField: <K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => void
  setVisibility: (field: RestaurantProfileVisibilityKey, value: boolean) => void
  setSocialLink: (platform: SocialPlatform, value: string) => void
  setShowAdvanced: (value: boolean) => void
  selectImage: (kind: "logo" | "primary", file: File | undefined) => void
}) {
  const label = (key: RestaurantProfileVisibilityKey) => getTranslation(visibilityLabelKeys[key] as never)
  const [aiDetailsOpen, setAiDetailsOpen] = useState(false)
  const [socialDetailsOpen, setSocialDetailsOpen] = useState(false)
  const populatedSocialFields = EDIT_SOCIAL_FIELDS.filter(({ platform }) => Boolean(form.social_links[platform]?.trim()))
  const socialFields = socialDetailsOpen ? EDIT_SOCIAL_FIELDS : populatedSocialFields

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-violet-100 bg-violet-50/45 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-600">{getTranslation("marketing.quickSetup" as never)}</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">{getTranslation("marketing.guestBasics" as never)}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{getTranslation("marketing.profileEditorDescription" as never)}</p>
      </div>

      <section className="space-y-4">
        <div className="max-w-xl space-y-1.5">
          <Label htmlFor="profile-name">{getTranslation("onboarding.name" as never)}</Label>
          <Input id="profile-name" value={form.name} onChange={(event) => setField("name", event.target.value)} required />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <AssetPicker label={getTranslation("onboarding.logo" as never)} value={form.logo_url} file={logoFile} onChange={(file) => selectImage("logo", file)} />
          <AssetPicker label={getTranslation("marketing.bannerImage" as never)} value={form.primary_image_url} file={primaryFile} onChange={(file) => selectImage("primary", file)} />
        </div>

        <FieldWithVisibility
          id="profile-description"
          label={getTranslation("onboarding.description" as never)}
          visibleLabel={label("description")}
          checked={form.profile_visibility.description}
          onCheckedChange={(checked) => setVisibility("description", checked)}
        >
          <Textarea id="profile-description" value={form.description} onChange={(event) => setField("description", event.target.value)} rows={3} maxLength={600} placeholder={getTranslation("onboarding.descriptionPlaceholder" as never)} />
        </FieldWithVisibility>

        <div className="grid gap-4 sm:grid-cols-3">
          <FieldWithVisibility id="profile-cuisine" label={getTranslation("onboarding.cuisine" as never)} visibleLabel={label("cuisine")} checked={form.profile_visibility.cuisine} onCheckedChange={(checked) => setVisibility("cuisine", checked)}>
            <Input id="profile-cuisine" value={form.cuisine} onChange={(event) => setField("cuisine", event.target.value)} placeholder={getTranslation("manage.restaurantForm.profileCuisineExample" as never)} />
          </FieldWithVisibility>
          <FieldWithVisibility id="profile-atmosphere" label={getTranslation("onboarding.atmosphere" as never)} visibleLabel={label("atmosphere")} checked={form.profile_visibility.atmosphere} onCheckedChange={(checked) => setVisibility("atmosphere", checked)}>
            <Input id="profile-atmosphere" value={form.atmosphere} onChange={(event) => setField("atmosphere", event.target.value)} placeholder={getTranslation("manage.restaurantForm.profileAtmosphereExample" as never)} />
          </FieldWithVisibility>
          <FieldWithVisibility id="profile-hours" label={getTranslation("onboarding.openingHours" as never)} visibleLabel={label("hours")} checked={form.profile_visibility.hours} onCheckedChange={(checked) => setVisibility("hours", checked)}>
            <Input id="profile-hours" value={form.hours} onChange={(event) => setField("hours", event.target.value)} placeholder="09:00–22:00" />
          </FieldWithVisibility>
        </div>

        <FieldWithVisibility id="profile-location" label={getTranslation("marketing.locationAddress" as never)} visibleLabel={label("location")} checked={form.profile_visibility.location} onCheckedChange={(checked) => setVisibility("location", checked)}>
          <Input id="profile-location" value={form.location} onChange={(event) => setField("location", event.target.value)} placeholder={getTranslation("manage.restaurantForm.profileLocationExample" as never)} />
        </FieldWithVisibility>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldWithVisibility id="profile-phone" label={getTranslation("onboarding.phone" as never)} visibleLabel={label("phone")} checked={form.profile_visibility.phone} onCheckedChange={(checked) => setVisibility("phone", checked)}>
            <Input id="profile-phone" type="tel" value={form.phone} onChange={(event) => setField("phone", event.target.value)} placeholder="+90…" />
          </FieldWithVisibility>
          <FieldWithVisibility id="profile-whatsapp" label={getTranslation("marketing.whatsappNumber" as never)} visibleLabel={label("whatsapp")} checked={form.profile_visibility.whatsapp} onCheckedChange={(checked) => setVisibility("whatsapp", checked)}>
            <Input id="profile-whatsapp" type="tel" value={form.whatsapp} onChange={(event) => setField("whatsapp", event.target.value)} placeholder="+90…" />
          </FieldWithVisibility>
        </div>

        <RestaurantAiReadiness
          compact
          restaurant={{ id: restaurant.id, slug: form.slug, name: form.name, location: form.location, address_line1: form.address_line1, address_line2: form.address_line2, address_locality: form.address_locality, address_region: form.address_region, address_postal_code: form.address_postal_code, address_country: form.address_country, latitude: form.latitude, longitude: form.longitude, phone: form.phone, official_website_url: form.official_website_url, timezone: form.timezone, status: form.status, platform_status: restaurant.platform_status, reservation_enabled: reservation.reservation_enabled }}
          details={{
            label: "AI & search details",
            summary: "Known values are prefilled. Update only what is missing or incorrect.",
            open: aiDetailsOpen,
            onOpenChange: setAiDetailsOpen,
            children: (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["address_line1", "address_line2", "address_locality", "address_region", "address_postal_code", "address_country"] as const).map((field) => (
                    <div key={field} className="space-y-1">
                      <Label htmlFor={`profile-${field}`} className="text-xs">{field.replace("address_", "").replaceAll("_", " ")}</Label>
                      <Input id={`profile-${field}`} value={form[field]} onChange={(event) => setField(field, event.target.value)} className="h-9 bg-white text-sm" />
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1"><Label htmlFor="profile-latitude" className="text-xs">Latitude</Label><Input id="profile-latitude" type="number" step="any" min="-90" max="90" value={form.latitude ?? ""} onChange={(event) => setField("latitude", event.target.value === "" ? null : Number(event.target.value))} className="h-9 bg-white text-sm" /></div>
                  <div className="space-y-1"><Label htmlFor="profile-longitude" className="text-xs">Longitude</Label><Input id="profile-longitude" type="number" step="any" min="-180" max="180" value={form.longitude ?? ""} onChange={(event) => setField("longitude", event.target.value === "" ? null : Number(event.target.value))} className="h-9 bg-white text-sm" /></div>
                  <div className="space-y-1"><Label htmlFor="profile-official-website" className="text-xs">Official website</Label><Input id="profile-official-website" type="url" value={form.official_website_url} onChange={(event) => setField("official_website_url", event.target.value)} placeholder="https://…" className="h-9 bg-white text-sm" /></div>
                </div>
              </div>
            ),
          }}
        />
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50/35 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{getTranslation("marketing.publicLinks" as never)}</h3>
            <p className="mt-1 text-xs text-slate-500">{getTranslation("marketing.profileLinksDescription" as never)}</p>
          </div>
          <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldWithVisibility id="profile-menu" label={getTranslation("marketing.menuLink" as never)} visibleLabel={label("menu")} checked={form.profile_visibility.menu} onCheckedChange={(checked) => setVisibility("menu", checked)}>
            <Input id="profile-menu" type="url" value={form.menu_url} onChange={(event) => setField("menu_url", event.target.value)} placeholder="https://…" />
          </FieldWithVisibility>
          <FieldWithVisibility id="profile-location-url" label={getTranslation("marketing.locationLink" as never)} visibleLabel={label("location")} checked={form.profile_visibility.location} onCheckedChange={(checked) => setVisibility("location", checked)}>
            <Input id="profile-location-url" type="url" value={form.location_url} onChange={(event) => setField("location_url", event.target.value)} placeholder="https://maps…" />
          </FieldWithVisibility>
          <FieldWithVisibility id="profile-events" label={getTranslation("marketing.eventsLink" as never)} visibleLabel={label("events")} checked={form.profile_visibility.events} onCheckedChange={(checked) => setVisibility("events", checked)}>
            <Input id="profile-events" type="url" value={form.events_url} onChange={(event) => setField("events_url", event.target.value)} placeholder="https://…" />
          </FieldWithVisibility>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50/35 p-4">
        <div className="flex items-start justify-between gap-4">
          <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => setSocialDetailsOpen(!socialDetailsOpen)} aria-expanded={socialDetailsOpen}>
            <span className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{getTranslation("marketing.socialMedia" as never)}</h3>
              <span className="mt-0.5 block truncate text-xs text-slate-500">{populatedSocialFields.length ? `${populatedSocialFields.length} profile${populatedSocialFields.length === 1 ? "" : "s"} added` : "No profiles added yet"}</span>
            </span>
            <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${socialDetailsOpen ? "rotate-180" : ""}`} />
          </button>
          <VisibilitySwitch label={label("social")} checked={form.profile_visibility.social} onCheckedChange={(checked) => setVisibility("social", checked)} />
        </div>
        {socialFields.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {socialFields.map(({ platform, id, labelKey, placeholder }) => (
              <SocialUrlField key={platform} id={id} label={getTranslation(labelKey as never)} value={form.social_links[platform] || ""} onChange={(value) => setSocialLink(platform, value)} placeholder={placeholder} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500">Expand to add social profiles.</p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm shadow-slate-900/[0.02]">
        <button type="button" className="flex w-full items-center justify-between gap-4 p-4 text-left" onClick={() => setShowAdvanced(!showAdvanced)} aria-expanded={showAdvanced}>
          <span>
            <span className="block text-sm font-semibold text-slate-900">{getTranslation("marketing.advancedDetails" as never)}</span>
            <span className="mt-1 block text-xs text-slate-500">{getTranslation("marketing.advancedDescription" as never)}</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        </button>
        {showAdvanced && (
          <div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-slug">{getTranslation("marketing.publicSlug" as never)}</Label>
              <Input id="profile-slug" value={form.slug} onChange={(event) => setField("slug", event.target.value)} pattern="[a-z0-9-]+" required />
              <p className="text-[11px] text-slate-500">https://{form.slug || "your-restaurant"}.{rootDomain}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-timezone">{getTranslation("onboarding.timezone" as never)}</Label>
              <Input id="profile-timezone" value={form.timezone} onChange={(event) => setField("timezone", event.target.value)} placeholder={getTranslation("manage.restaurantForm.timezoneExample" as never)} />
            </div>
            <div className="sm:col-span-2">
              <ToggleRow label={getTranslation("marketing.publishedProfile" as never)} description={getTranslation("marketing.publishedDescription" as never, { slug: form.slug })} checked={form.status === "published"} onCheckedChange={(checked) => setField("status", checked ? "published" : "unpublished")} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function ReservationTab({
  reservation,
  getTranslation,
  setReservation,
}: {
  reservation: ReservationFormState
  getTranslation: (key: never, variables?: Record<string, string | number>) => string
  setReservation: (value: ReservationFormState) => void
}) {
  const setField = <K extends keyof ReservationFormState>(field: K, value: ReservationFormState[K]) => {
    setReservation({ ...reservation, [field]: value })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-100 bg-amber-50/45 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-600">{getTranslation("manage.restaurantForm.reservations" as never)}</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">{getTranslation("manage.restaurantForm.reservationHeading" as never)}</h2>
        <p className="mt-1 text-sm text-slate-500">{getTranslation("manage.restaurantForm.onlineDescription" as never)}</p>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <ToggleRow label={getTranslation("manage.restaurantForm.onlineAvailability" as never)} description={getTranslation("manage.restaurantForm.onlineDescription" as never)} checked={reservation.reservation_enabled} onCheckedChange={(checked) => setField("reservation_enabled", checked)} />
        <ToggleRow label={getTranslation("manage.restaurantForm.diningOnly" as never)} description={getTranslation("manage.restaurantForm.diningOnlyDescription" as never)} checked={reservation.meal_only_reservations} onCheckedChange={(checked) => setField("meal_only_reservations", checked)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CompactNumberField label={getTranslation("manage.restaurantForm.timeSlot" as never)} value={reservation.time_slot_duration} min={15} max={240} step={15} onChange={(value) => setField("time_slot_duration", value)} />
        <CompactNumberField label={getTranslation("manage.restaurantForm.minParty" as never)} value={reservation.min_party_size} min={1} max={reservation.max_party_size} onChange={(value) => setField("min_party_size", value)} />
        <CompactNumberField label={getTranslation("manage.restaurantForm.maxParty" as never)} value={reservation.max_party_size} min={reservation.min_party_size} max={100} onChange={(value) => setField("max_party_size", value)} />
        <CompactNumberField label={getTranslation("manage.restaurantForm.advanceDays" as never)} value={reservation.advance_booking_days} min={0} max={365} onChange={(value) => setField("advance_booking_days", value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TimeField label={getTranslation("manage.restaurantForm.openingTime" as never)} value={reservation.opening_time} onChange={(value) => setField("opening_time", value)} />
        <TimeField label={getTranslation("manage.restaurantForm.closingTime" as never)} value={reservation.closing_time} onChange={(value) => setField("closing_time", value)} />
        <CompactNumberField label={getTranslation("manage.restaurantForm.minAdvanceHours" as never)} value={reservation.min_advance_hours} min={0} max={168} onChange={(value) => setField("min_advance_hours", value)} />
      </div>

      <div className="space-y-3">
        <Label>{getTranslation("manage.restaurantForm.availableDays" as never)}</Label>
        <div className="flex flex-wrap gap-2">
          {dayLabelKeys.map((day) => {
            const active = reservation.allowed_days_of_week.includes(day.value)
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => setField("allowed_days_of_week", active ? reservation.allowed_days_of_week.filter((value) => value !== day.value) : [...reservation.allowed_days_of_week, day.value].sort())}
                className={`min-w-12 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-400"}`}
              >
                {getTranslation(day.key as never)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="reservation-start-date">{getTranslation("manage.restaurantForm.firstReservationDate" as never)}</Label>
        <Input id="reservation-start-date" type="date" value={reservation.reservation_start_date} onChange={(event) => setField("reservation_start_date", event.target.value)} />
      </div>
    </div>
  )
}

function ProfilePreview({ form, reservation, getTranslation }: { form: ProfileFormState; reservation: ReservationFormState; getTranslation: (key: never, variables?: Record<string, string | number>) => string }) {
  const visible = form.profile_visibility
  const whatsappNumber = visible.whatsapp ? (form.whatsapp || (visible.phone ? form.phone : "")).replace(/\D/g, "") : ""
  const locationHref = visible.location && (form.location_url || form.location) ? form.location_url || `https://maps.google.com/?q=${encodeURIComponent(form.location)}` : ""
  // The editor preview should reflect the current draft immediately. Keep
  // validation for save time, but do not normalize an in-progress URL away.
  const socialLinks = form.social_links
  const visibleSocialLinks = PREVIEW_SOCIAL_PLATFORMS.filter(({ platform }) => visible.social && Boolean(socialLinks[platform]?.trim()))
  const actionLinks = [
    visible.menu && form.menu_url ? { label: getTranslation("manage.restaurantForm.preview.menu" as never), icon: <Utensils className="h-3.5 w-3.5" />, href: form.menu_url } : null,
    visible.location && locationHref ? { label: getTranslation("manage.restaurantForm.preview.location" as never), icon: <MapPin className="h-3.5 w-3.5" />, href: locationHref } : null,
    visible.events && form.events_url ? { label: getTranslation("manage.restaurantForm.preview.events" as never), icon: <CalendarDays className="h-3.5 w-3.5" />, href: form.events_url } : null,
  ].filter(Boolean)

  return (
    <aside className="restaurant-profile-preview xl:sticky xl:top-5">
      <div className="restaurant-profile-preview-heading">
        <div className="restaurant-profile-preview-heading-title"><span className="restaurant-profile-preview-heading-icon"><Eye className="h-3.5 w-3.5" /></span>{getTranslation("manage.restaurantForm.preview.livePreview" as never)}</div>
        <span className="restaurant-profile-preview-status"><span className="restaurant-profile-preview-status-dot" />{getTranslation("manage.restaurantForm.preview.draft" as never)}</span>
      </div>
      <div className="restaurant-profile-preview-card">
        <div className="restaurant-profile-preview-hero">
          {visible.banner && form.primary_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.primary_image_url} alt="" className="restaurant-profile-preview-hero-image" />
          ) : (
            <div className="restaurant-profile-preview-hero-fallback">{form.name.slice(0, 1).toUpperCase()}</div>
          )}
          <div className="restaurant-profile-preview-hero-shade" />
          <div className="restaurant-profile-preview-hero-toolbar">
            <span className="restaurant-profile-preview-hero-label">{getTranslation("manage.restaurantForm.preview.restaurantProfile" as never)}</span>
            {(visible.whatsapp && whatsappNumber) || (visible.phone && form.phone) ? (
              <div className="restaurant-profile-preview-contact-actions">
                {visible.whatsapp && whatsappNumber && <span className="restaurant-profile-preview-contact restaurant-profile-preview-contact-whatsapp"><MessageCircle className="h-3.5 w-3.5" /></span>}
                {visible.phone && form.phone && <span className="restaurant-profile-preview-contact"><Phone className="h-3.5 w-3.5" /></span>}
              </div>
            ) : null}
          </div>
          {visible.logo && (
            <div className="restaurant-profile-preview-logo">
              {form.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logo_url} alt="" className="h-full w-full object-contain p-1.5" />
              ) : <div className="flex h-full items-center justify-center text-sm font-bold text-slate-700">{form.name.slice(0, 1).toUpperCase()}</div>}
            </div>
          )}
        </div>
        <div className="restaurant-profile-preview-body">
          <div className="restaurant-profile-preview-identity">
            <div className="min-w-0">
              <span className="restaurant-profile-preview-kicker">{getTranslation("public.reserveviaDining" as never)}</span>
              <h3>{form.name || getTranslation("manage.restaurantForm.preview.restaurantName" as never)}</h3>
            </div>
            <span className="restaurant-profile-preview-live-pill"><span />{getTranslation("public.live" as never)}</span>
          </div>
          {visible.description && form.description && <p className="restaurant-profile-preview-description line-clamp-2">{form.description}</p>}
          <div className="restaurant-profile-preview-info-grid">
            {([
              ["cuisine", form.cuisine, getTranslation("onboarding.cuisine" as never)],
              ["hours", form.hours, getTranslation("onboarding.openingHours" as never)],
              ["atmosphere", form.atmosphere, getTranslation("onboarding.atmosphere" as never)],
            ] as const).map(([key, value, label]) => visible[key] && value ? (
              <div key={key} className="restaurant-profile-preview-info-item">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ) : null)}
          </div>
          {visible.reserve && reservation.reservation_enabled && <div className="restaurant-profile-preview-reserve">{getTranslation("manage.restaurantForm.preview.reserveTable" as never)}<CalendarDays className="h-3.5 w-3.5" /></div>}
          {(visibleSocialLinks.length > 0 || actionLinks.length > 0) && (
            <div className="restaurant-profile-preview-footer">
              {visibleSocialLinks.length > 0 && (
                <div className="restaurant-profile-preview-social-row" aria-label={getTranslation("manage.restaurantForm.preview.socialMediaProfiles" as never)}>
                  <span className="restaurant-profile-preview-footer-label">{getTranslation("manage.restaurantForm.preview.social" as never)}</span>
                  <div className="restaurant-profile-preview-social-links">
                    {visibleSocialLinks.map(({ platform, label, Icon }) => (
                      <span key={platform} className="restaurant-profile-preview-social-link" data-platform={platform} aria-label={label} title={label}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {actionLinks.length > 0 && <div className="restaurant-profile-preview-footer-actions">{actionLinks.map((action) => action && <span key={action.label} className="restaurant-profile-preview-footer-action"><span>{action.icon}</span>{action.label}</span>)}</div>}
            </div>
          )}
        </div>
      </div>
      <p className="restaurant-profile-preview-note">{getTranslation("manage.restaurantForm.preview.note" as never)}</p>
    </aside>
  )
}

function VisibilitySwitch({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  )
}

function FieldWithVisibility({ id, label, visibleLabel, checked, onCheckedChange, children }: { id: string; label: string; visibleLabel: string; checked: boolean; onCheckedChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={visibleLabel} />
      </div>
      {children}
    </div>
  )
}

function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="mt-0.5 text-xs leading-4 text-slate-500">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  )
}

function CompactNumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} />
    </div>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="time" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function AssetPicker({ label, value, file, onChange }: { label: string; value: string; file: File | null; onChange: (file: File | undefined) => void }) {
  const { getTranslation } = useLanguage()
  const filePreviewUrl = useObjectUrl(file)
  const imageUrl = filePreviewUrl || value

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <label className="relative flex min-h-28 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 transition-colors hover:border-slate-500">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <><img src={imageUrl} alt={`${label} preview`} className="h-28 w-full object-contain p-3" />{file && <span className="absolute bottom-2 left-2 right-2 truncate rounded-lg bg-white/90 px-2 py-1 text-center text-[11px] font-medium text-slate-600">{file.name}</span>}</>
        ) : <span className="flex items-center gap-2 text-sm font-medium text-slate-500"><ImagePlus className="h-5 w-5" /> {getTranslation("onboarding.imageAdd" as never, { label: label.toLowerCase() })}</span>}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="sr-only" onChange={(event) => onChange(event.target.files?.[0])} />
      </label>
      <p className="text-[11px] text-slate-500">{getTranslation("onboarding.imageLimit" as never)}</p>
    </div>
  )
}

function SocialUrlField({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode="url" />
    </div>
  )
}
