'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarDays, Check, Clock3, Store, Trash2 } from 'lucide-react';
import { createRestaurant, updateRestaurant } from '@/app/manage/actions';
import { getReservationAreas, bulkUpdateReservationAreas } from '@/app/manage/reservation-areas-actions';
import { ReservationAreasForm } from '@/components/manage/reservation-areas-form';
import { toast } from 'sonner';
import type { Restaurant } from '@/types/supabase';
import { useLanguage } from '@/context/language-context';
import type { TranslationKey } from '@/i18n';
import { RestaurantAiReadiness } from '@/components/restaurant-ai-readiness';
import { normalizeSocialLinks } from '@/lib/restaurant-profile';

interface RestaurantFormProps {
  restaurant?: RestaurantWithMedia;
  onSuccess?: () => void;
  onClose?: () => void;
  open?: boolean;
}

interface RestaurantWithMedia extends Restaurant {
  media?: { media_url: string }[];
}

interface ReservationAreaFormData {
  id?: string
  clientId?: string
  name: string
  description: string
  is_active: boolean
  display_order: number
  opening_time: string
  closing_time: string
  time_slot_duration: number | null
  max_party_size: number | null
  min_party_size: number | null
  advance_booking_days: number | null
  min_advance_hours: number | null
  allowed_days_of_week: number[] | null
  blocked_dates: string[]
  max_concurrent_reservations: number | null
  useRestaurantDefaults: boolean
}

interface ReservationBlockedInterval {
  date: string
  start_time: string
  end_time: string
  message: string
}

interface ReservationNotice {
  start_date: string
  end_date: string
  title: string
  message: string
  active: boolean
  recurring_weekly: boolean
  recurring_days: number[]
}

const dayNames: { value: number; key: TranslationKey }[] = [
  { value: 1, key: "reservationAreas.dayMonday" },
  { value: 2, key: "reservationAreas.dayTuesday" },
  { value: 3, key: "reservationAreas.dayWednesday" },
  { value: 4, key: "reservationAreas.dayThursday" },
  { value: 5, key: "reservationAreas.dayFriday" },
  { value: 6, key: "reservationAreas.daySaturday" },
  { value: 7, key: "reservationAreas.daySunday" },
]

function normalizeBlockedIntervals(value: unknown): ReservationBlockedInterval[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const interval = item as Partial<ReservationBlockedInterval>
      if (!interval.date || !interval.start_time || !interval.end_time) return null

      return {
        date: interval.date,
        start_time: interval.start_time,
        end_time: interval.end_time,
        message: interval.message || "",
      }
    })
    .filter((item): item is ReservationBlockedInterval => Boolean(item))
}

function normalizeReservationNotices(value: unknown): ReservationNotice[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const notice = item as Partial<ReservationNotice>
      const recurringDays = Array.isArray(notice.recurring_days)
        ? notice.recurring_days.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7)
        : []
      const isRecurring = notice.recurring_weekly === true && recurringDays.length > 0
      if (!notice.message || (!isRecurring && (!notice.start_date || !notice.end_date))) return null

      return {
        start_date: notice.start_date || "",
        end_date: notice.end_date || "",
        title: notice.title || "",
        message: notice.message,
        active: notice.active !== false,
        recurring_weekly: isRecurring,
        recurring_days: recurringDays,
      }
    })
    .filter((item): item is ReservationNotice => Boolean(item))
}

export function RestaurantForm({ restaurant, onSuccess, onClose, open = true }: RestaurantFormProps) {
  const { getTranslation, translateMessage } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [reservationAreas, setReservationAreas] = useState<ReservationAreaFormData[]>([]);
  const [formData, setFormData] = useState({
    name: restaurant?.name || '',
    description: restaurant?.description || '',
    cuisine: restaurant?.cuisine || '',
    location: restaurant?.location || '',
    phone: restaurant?.phone || '',
    address_line1: restaurant?.address_line1 || '',
    address_line2: restaurant?.address_line2 || '',
    address_locality: restaurant?.address_locality || '',
    address_region: restaurant?.address_region || '',
    address_postal_code: restaurant?.address_postal_code || '',
    address_country: restaurant?.address_country || '',
    latitude: restaurant?.latitude ?? null,
    longitude: restaurant?.longitude ?? null,
    official_website_url: restaurant?.official_website_url || normalizeSocialLinks(restaurant?.social_links).website || '',
    hours: restaurant?.hours || '',
    atmosphere: restaurant?.atmosphere || '',
    media_type: restaurant?.media_type || '',
    media_url: restaurant?.media?.[0]?.media_url || '',
    reservation_enabled: restaurant?.reservation_enabled ?? true,
    opening_time: restaurant?.opening_time || '09:00',
    closing_time: restaurant?.closing_time || '22:00',
    time_slot_duration: restaurant?.time_slot_duration || 30,
    advance_booking_days: restaurant?.advance_booking_days || 30,
    min_advance_hours: restaurant?.min_advance_hours || 2,
    max_party_size: restaurant?.max_party_size || 12,
    min_party_size: restaurant?.min_party_size || 1,
    reservation_start_date: restaurant?.reservation_start_date || '',
    reservation_blocked_intervals: normalizeBlockedIntervals(restaurant?.reservation_blocked_intervals),
    reservation_notices: normalizeReservationNotices(restaurant?.reservation_notices),
    allowed_days_of_week: restaurant?.allowed_days_of_week || [1, 2, 3, 4, 5, 6, 7],
    meal_only_reservations: (restaurant as any)?.meal_only_reservations ?? false,
  });

  // Reset form when creating a new restaurant (open without a restaurant)
  useEffect(() => {
    if (open && !restaurant) {
      setFormData({
        name: '',
        description: '',
        cuisine: '',
        location: '',
        phone: '',
        address_line1: '',
        address_line2: '',
        address_locality: '',
        address_region: '',
        address_postal_code: '',
        address_country: '',
        latitude: null,
        longitude: null,
        official_website_url: '',
        hours: '',
        atmosphere: '',
        media_type: '',
        media_url: '',
        reservation_enabled: true,
        opening_time: '09:00',
        closing_time: '22:00',
        time_slot_duration: 30,
        advance_booking_days: 30,
        min_advance_hours: 2,
        max_party_size: 12,
        min_party_size: 1,
        reservation_start_date: '',
        reservation_blocked_intervals: [],
        reservation_notices: [],
        allowed_days_of_week: [1, 2, 3, 4, 5, 6, 7],
        meal_only_reservations: false,
      })
      setReservationAreas([])
    }
  }, [open, restaurant])

  const restaurantId = restaurant?.id

  const loadReservationAreas = useCallback(async () => {
    if (!restaurantId) return;
    
    const result = await getReservationAreas(restaurantId);
    if (result.success) {
      const fetched = result.data.map(area => ({
        id: area.id,
        name: area.name,
        description: area.description || '',
        is_active: area.is_active,
        display_order: area.display_order,
        opening_time: area.opening_time || formData.opening_time,
        closing_time: area.closing_time || formData.closing_time,
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
        )
      }))

      // Preserve any unsaved local areas (without an id)
      setReservationAreas(prev => {
        const unsaved = prev.filter(a => !a.id)
        return [...fetched, ...unsaved]
      })
    }
  }, [formData.closing_time, formData.opening_time, restaurantId]);

  // When an existing restaurant is selected for editing, sync form fields
  useEffect(() => {
    if (!restaurant) return;
    setFormData({
      name: restaurant.name || '',
      description: restaurant.description || '',
      cuisine: restaurant.cuisine || '',
      location: restaurant.location || '',
      phone: restaurant.phone || '',
      address_line1: restaurant.address_line1 || '',
      address_line2: restaurant.address_line2 || '',
      address_locality: restaurant.address_locality || '',
      address_region: restaurant.address_region || '',
      address_postal_code: restaurant.address_postal_code || '',
      address_country: restaurant.address_country || '',
      latitude: restaurant.latitude ?? null,
      longitude: restaurant.longitude ?? null,
      official_website_url: restaurant.official_website_url || normalizeSocialLinks(restaurant.social_links).website || '',
      hours: restaurant.hours || '',
      atmosphere: restaurant.atmosphere || '',
      media_type: restaurant.media_type || '',
      media_url: restaurant.media?.[0]?.media_url || '',
      reservation_enabled: restaurant.reservation_enabled ?? true,
      opening_time: restaurant.opening_time || '09:00',
      closing_time: restaurant.closing_time || '22:00',
      time_slot_duration: restaurant.time_slot_duration || 30,
      advance_booking_days: restaurant.advance_booking_days || 30,
      min_advance_hours: restaurant.min_advance_hours || 2,
      max_party_size: restaurant.max_party_size || 12,
      min_party_size: restaurant.min_party_size || 1,
      reservation_start_date: restaurant.reservation_start_date || '',
      reservation_blocked_intervals: normalizeBlockedIntervals(restaurant.reservation_blocked_intervals),
      reservation_notices: normalizeReservationNotices(restaurant.reservation_notices),
      allowed_days_of_week: restaurant.allowed_days_of_week || [1, 2, 3, 4, 5, 6, 7],
      meal_only_reservations: (restaurant as any)?.meal_only_reservations ?? false,
    });
    // Reset areas until loaded for this restaurant
    setReservationAreas([])
  }, [restaurant]);

  // Load reservation areas for existing restaurant
  useEffect(() => {
    if (restaurant?.id) {
      loadReservationAreas();
    }
  }, [loadReservationAreas, restaurant?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const restaurantPayload = {
        ...formData,
        reservation_blocked_intervals: formData.reservation_blocked_intervals.filter(
          (interval) => interval.date && interval.start_time && interval.end_time
        ),
        reservation_notices: formData.reservation_notices
          .filter((notice) => notice.message.trim() && (
            (notice.recurring_weekly && (notice.recurring_days?.length ?? 0) > 0) ||
            (!notice.recurring_weekly && notice.start_date && notice.end_date)
          ))
          .map((notice) => ({
            ...notice,
            title: notice.title.trim(),
            message: notice.message.trim(),
          })),
      }

      let result;
      if (restaurant) {
        result = await updateRestaurant(restaurant.id, restaurantPayload);
      } else {
        result = await createRestaurant(restaurantPayload);
      }

      if (result.success) {
        // Save reservation areas if restaurant was created/updated successfully
        if (reservationAreas.length > 0 && restaurant?.id) {
          const areasData = reservationAreas.map(area => ({
            id: area.id,
            restaurant_id: restaurant.id,
            name: area.name,
            description: area.description,
            is_active: area.is_active,
            display_order: area.display_order,
            opening_time: area.useRestaurantDefaults ? undefined : area.opening_time,
            closing_time: area.useRestaurantDefaults ? undefined : area.closing_time,
            time_slot_duration: area.useRestaurantDefaults ? undefined : (area.time_slot_duration ?? undefined),
            max_party_size: area.useRestaurantDefaults ? undefined : (area.max_party_size ?? undefined),
            min_party_size: area.useRestaurantDefaults ? undefined : (area.min_party_size ?? undefined),
            advance_booking_days: area.useRestaurantDefaults ? undefined : (area.advance_booking_days ?? undefined),
            min_advance_hours: area.useRestaurantDefaults ? undefined : (area.min_advance_hours ?? undefined),
            allowed_days_of_week: area.useRestaurantDefaults ? undefined : (area.allowed_days_of_week ?? undefined),
            blocked_dates: area.blocked_dates || [],
            max_concurrent_reservations: area.max_concurrent_reservations ?? undefined,
          }));

          const areasResult = await bulkUpdateReservationAreas(restaurant.id, areasData);
          if (!areasResult.success) {
            toast.error(getTranslation("manage.errors.restaurantSavedAreasFailed", { message: translateMessage(areasResult.message || getTranslation("manage.errors.areasUpdateFailed")) }));
            return;
          }
        }

        toast.success(translateMessage(result.message));
        onSuccess?.();
        onClose?.();
      } else {
        toast.error(translateMessage(result.message));
      }
    } catch {
      toast.error(getTranslation("manage.errors.unexpected"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDayToggle = (day: number, checked: boolean) => {
    const currentDays = formData.allowed_days_of_week;
    const newDays = checked
      ? [...currentDays, day].sort()
      : currentDays.filter(d => d !== day);
    
    setFormData({ ...formData, allowed_days_of_week: newDays });
  };

  const handleAreasChange = (areas: ReservationAreaFormData[]) => {
    setReservationAreas(areas);
  };

  const addBlockedInterval = () => {
    setFormData({
      ...formData,
      reservation_blocked_intervals: [
        ...formData.reservation_blocked_intervals,
        { date: "", start_time: "21:00", end_time: "24:00", message: "" },
      ],
    })
  }

  const updateBlockedInterval = (index: number, updates: Partial<ReservationBlockedInterval>) => {
    setFormData({
      ...formData,
      reservation_blocked_intervals: formData.reservation_blocked_intervals.map((interval, i) =>
        i === index ? { ...interval, ...updates } : interval
      ),
    })
  }

  const removeBlockedInterval = (index: number) => {
    setFormData({
      ...formData,
      reservation_blocked_intervals: formData.reservation_blocked_intervals.filter((_, i) => i !== index),
    })
  }

  const addReservationNotice = () => {
    setFormData({
      ...formData,
      reservation_notices: [
        ...formData.reservation_notices,
        { start_date: "", end_date: "", title: "", message: "", active: true, recurring_weekly: false, recurring_days: [] },
      ],
    })
  }

  const updateReservationNotice = (index: number, updates: Partial<ReservationNotice>) => {
    setFormData({
      ...formData,
      reservation_notices: formData.reservation_notices.map((notice, i) =>
        i === index ? { ...notice, ...updates } : notice
      ),
    })
  }

  const toggleRecurringNoticeDay = (index: number, day: number, checked: boolean) => {
    const notice = formData.reservation_notices[index]
    const currentDays = notice.recurring_days ?? []
    const recurring_days = checked
      ? [...currentDays, day].sort((a, b) => a - b)
      : currentDays.filter((value) => value !== day)
    updateReservationNotice(index, { recurring_days })
  }

  const removeReservationNotice = (index: number) => {
    setFormData({
      ...formData,
      reservation_notices: formData.reservation_notices.filter((_, i) => i !== index),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="grid h-[min(760px,calc(100vh-2rem))] w-[calc(100vw-1.5rem)] max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl border-slate-200 bg-white p-0 shadow-2xl shadow-slate-950/20">
        <DialogHeader className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-5 py-5 text-left sm:px-6">
          <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-amber-400/15 blur-2xl" />
          <div className="relative flex items-start gap-3 pr-8">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-amber-300 ring-1 ring-white/15">
              <Store className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-xl font-semibold tracking-tight text-white">
                {restaurant ? getTranslation("manage.restaurantForm.editTitle") : getTranslation("manage.restaurantForm.addTitle")}
              </DialogTitle>
              <p className="text-sm text-slate-300">
                {restaurant ? getTranslation("manage.restaurantForm.editDescription") : getTranslation("manage.restaurantForm.addDescription")}
              </p>
            </div>
          </div>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="contents">
          <TabsList className="mx-5 mt-4 grid h-10 grid-cols-3 rounded-xl bg-slate-100 p-1 sm:mx-6">
            <TabsTrigger value="basic" className="rounded-lg text-xs font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm sm:text-sm">{getTranslation("manage.restaurantForm.details")}</TabsTrigger>
            <TabsTrigger value="reservations" className="rounded-lg text-xs font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm sm:text-sm">{getTranslation("manage.restaurantForm.reservations")}</TabsTrigger>
            <TabsTrigger value="areas" className="rounded-lg text-xs font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm sm:text-sm">{getTranslation("manage.restaurantForm.areas")}</TabsTrigger>
          </TabsList>
          
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4 sm:px-6 [&_input]:h-10 [&_input]:rounded-xl [&_input]:border-slate-200 [&_input]:bg-slate-50/70 [&_input]:text-sm [&_input]:shadow-none [&_input]:transition-colors [&_input:focus]:border-slate-400 [&_input:focus]:bg-white [&_textarea]:rounded-xl [&_textarea]:border-slate-200 [&_textarea]:bg-slate-50/70 [&_label]:text-xs [&_label]:font-semibold [&_label]:text-slate-600">
            <TabsContent value="basic" className="mt-0 space-y-5">
              {restaurant && (
                <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-violet-950">{getTranslation("manage.restaurantForm.publicPagePrompt")}</p>
                    <p className="mt-1 text-xs leading-5 text-violet-800/80">{getTranslation("manage.restaurantForm.publicPageDescription")}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" asChild className="shrink-0 rounded-lg border-violet-200 bg-white text-violet-800 hover:bg-violet-100">
                    <Link href={`/manage/restaurants/${restaurant.id}/profile`}>{getTranslation("manage.restaurantForm.openProfile")}</Link>
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">{getTranslation("manage.restaurantForm.name")}</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={getTranslation("manage.restaurantForm.namePlaceholder")}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cuisine">{getTranslation("manage.restaurantForm.cuisine")}</Label>
                  <Input
                    id="cuisine"
                    value={formData.cuisine}
                    onChange={(e) => setFormData({ ...formData, cuisine: e.target.value })}
                    placeholder={getTranslation("manage.restaurantForm.cuisineExample")}
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div><p className="text-sm font-semibold text-slate-800">AI & search details</p><p className="mt-0.5 text-xs text-slate-500">Reservevia fills these from your profile or website when available.</p></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(["address_line1", "address_line2", "address_locality", "address_region", "address_postal_code", "address_country"] as const).map((field) => <div key={field} className="space-y-1.5"><Label htmlFor={field}>{field.replace("address_", "").replaceAll("_", " ")}</Label><Input id={field} value={formData[field]} onChange={(e) => setFormData({ ...formData, [field]: e.target.value })} /></div>)}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label htmlFor="latitude">Latitude</Label><Input id="latitude" type="number" step="any" min="-90" max="90" value={formData.latitude ?? ''} onChange={(e) => setFormData({ ...formData, latitude: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="longitude">Longitude</Label><Input id="longitude" type="number" step="any" min="-180" max="180" value={formData.longitude ?? ''} onChange={(e) => setFormData({ ...formData, longitude: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="official_website_url">Official website</Label><Input id="official_website_url" type="url" value={formData.official_website_url} onChange={(e) => setFormData({ ...formData, official_website_url: e.target.value })} placeholder="https://…" /></div>
                </div>
                <RestaurantAiReadiness restaurant={{ id: restaurant?.id || "pending", slug: restaurant?.slug || null, name: formData.name, location: formData.location, address_line1: formData.address_line1, address_line2: formData.address_line2, address_locality: formData.address_locality, address_region: formData.address_region, address_postal_code: formData.address_postal_code, address_country: formData.address_country, latitude: formData.latitude, longitude: formData.longitude, phone: formData.phone, official_website_url: formData.official_website_url, timezone: restaurant?.timezone || "UTC", status: restaurant?.status || "unpublished", platform_status: restaurant?.platform_status || "active", reservation_enabled: formData.reservation_enabled }} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">{getTranslation("manage.restaurantForm.description")}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={getTranslation("manage.restaurantForm.descriptionPlaceholder")}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="location">{getTranslation("manage.restaurantForm.location")}</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder={getTranslation("manage.restaurantForm.locationPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">{getTranslation("manage.restaurantForm.phone")}</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder={getTranslation("manage.restaurantForm.phonePlaceholder")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="hours">{getTranslation("manage.restaurantForm.hours")}</Label>
                  <Input
                    id="hours"
                    value={formData.hours}
                    onChange={(e) => setFormData({ ...formData, hours: e.target.value })}
                    placeholder={getTranslation("manage.restaurantForm.hoursPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="atmosphere">{getTranslation("manage.restaurantForm.atmosphere")}</Label>
                  <Input
                    id="atmosphere"
                    value={formData.atmosphere}
                    onChange={(e) => setFormData({ ...formData, atmosphere: e.target.value })}
                    placeholder={getTranslation("manage.restaurantForm.atmosphereExample")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="media_type">{getTranslation("manage.restaurantForm.mediaType")}</Label>
                  <Input
                    id="media_type"
                    value={formData.media_type}
                    onChange={(e) => setFormData({ ...formData, media_type: e.target.value })}
                    placeholder={getTranslation("manage.restaurantForm.mediaTypeExample")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="media_url">{getTranslation("manage.restaurantForm.mediaUrl")}</Label>
                  <Input
                    id="media_url"
                    value={formData.media_url}
                    onChange={(e) => setFormData({ ...formData, media_url: e.target.value })}
                    placeholder={getTranslation("manage.restaurantForm.mediaUrlExample")}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="reservations" className="mt-0 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="reservation-enabled" className="text-sm font-semibold text-slate-800">{getTranslation("manage.restaurantForm.onlineAvailability")}</Label>
                    <p className="mt-0.5 text-xs text-slate-500">{getTranslation("manage.restaurantForm.onlineDescription")}</p>
                  </div>
                  <Switch
                    id="reservation-enabled"
                    checked={formData.reservation_enabled}
                    onCheckedChange={(checked) => setFormData({ ...formData, reservation_enabled: checked })}
                  />
                </div>

                {formData.reservation_enabled && (
                  <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                    <div className="flex items-center justify-between gap-4 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200/70">
                      <div>
                        <Label htmlFor="meal-only-reservations" className="text-xs font-semibold text-slate-700">{getTranslation("manage.restaurantForm.diningOnly")}</Label>
                        <p className="mt-0.5 text-xs text-slate-500">{getTranslation("manage.restaurantForm.diningOnlyDescription")}</p>
                      </div>
                      <Switch
                        id="meal-only-reservations"
                        checked={formData.meal_only_reservations}
                        onCheckedChange={(checked) => setFormData({ ...formData, meal_only_reservations: checked })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-slate-700">{getTranslation("manage.restaurantForm.availableDays")}</Label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                        {dayNames.map(({ value, key }) => (
                          <label key={value} htmlFor={`day-${value}`} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300">
                            <Checkbox
                              id={`day-${value}`}
                              checked={formData.allowed_days_of_week.includes(value)}
                              onCheckedChange={(checked) => handleDayToggle(value, checked as boolean)}
                            />
                            {getTranslation(key).slice(0, 3)}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="opening-time">{getTranslation("manage.restaurantForm.openingTime")}</Label>
                        <Input id="opening-time" type="time" value={formData.opening_time} onChange={(e) => setFormData({ ...formData, opening_time: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="closing-time">{getTranslation("manage.restaurantForm.closingTime")}</Label>
                        <Input id="closing-time" type="time" value={formData.closing_time} onChange={(e) => setFormData({ ...formData, closing_time: e.target.value })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="time-slot-duration">{getTranslation("manage.restaurantForm.timeSlot")}</Label>
                        <Input id="time-slot-duration" type="number" min="15" max="240" step="15" value={formData.time_slot_duration} onChange={(e) => setFormData({ ...formData, time_slot_duration: parseInt(e.target.value) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="min-party-size">{getTranslation("manage.restaurantForm.minParty")}</Label>
                        <Input id="min-party-size" type="number" min="1" value={formData.min_party_size} onChange={(e) => setFormData({ ...formData, min_party_size: parseInt(e.target.value) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="max-party-size">{getTranslation("manage.restaurantForm.maxParty")}</Label>
                        <Input id="max-party-size" type="number" min="1" value={formData.max_party_size} onChange={(e) => setFormData({ ...formData, max_party_size: parseInt(e.target.value) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="advance-booking-days">{getTranslation("manage.restaurantForm.advanceDays")}</Label>
                        <Input id="advance-booking-days" type="number" min="1" max="365" value={formData.advance_booking_days} onChange={(e) => setFormData({ ...formData, advance_booking_days: parseInt(e.target.value) })} />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="min-advance-hours">{getTranslation("manage.restaurantForm.minAdvanceHours")}</Label>
                        <Input id="min-advance-hours" type="number" min="0" max="72" value={formData.min_advance_hours} onChange={(e) => setFormData({ ...formData, min_advance_hours: parseInt(e.target.value) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reservation-start-date">{getTranslation("manage.restaurantForm.firstReservationDate")}</Label>
                        <Input id="reservation-start-date" type="date" value={formData.reservation_start_date} onChange={(e) => setFormData({ ...formData, reservation_start_date: e.target.value })} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {formData.reservation_enabled && (
                <div className="space-y-4">
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm font-semibold text-slate-800">{getTranslation("manage.restaurantForm.notices")}</Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {getTranslation("manage.restaurantForm.noticeDescription")}
                        </p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addReservationNotice} className="shrink-0 rounded-lg border-slate-200 bg-white text-xs">
                        {getTranslation("manage.restaurantForm.addNotice")}
                      </Button>
                    </div>

                    {formData.reservation_notices.length > 0 && (
                      <div className="space-y-2.5">
                        {formData.reservation_notices.map((notice, index) => (
                          <div key={index} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><CalendarDays className="h-3.5 w-3.5" /></span>
                                {getTranslation("manage.restaurantForm.notice", { number: String(index + 1) })}
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                                  <Checkbox
                                    checked={notice.active}
                                    onCheckedChange={(checked) => updateReservationNotice(index, { active: checked as boolean })}
                                  />
                                  {getTranslation("manage.restaurantForm.active")}
                                </label>
                                <Button type="button" variant="ghost" size="icon" onClick={() => removeReservationNotice(index)} className="h-7 w-7 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={getTranslation("manage.restaurantForm.removeNotice", { number: String(index + 1) })}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                        <Label htmlFor={`notice-recurring-${index}`} className="text-xs font-semibold text-slate-700">{getTranslation("manage.restaurantForm.repeatWeekly")}</Label>
                                        <p className="mt-0.5 text-xs text-slate-500">{getTranslation("manage.restaurantForm.repeatDescription")}</p>
                                </div>
                                <Switch
                                  id={`notice-recurring-${index}`}
                                  checked={notice.recurring_weekly}
                                  onCheckedChange={(checked) => updateReservationNotice(index, { recurring_weekly: checked })}
                                />
                              </div>
                              {notice.recurring_weekly ? (
                                <div className="mt-3 border-t border-slate-200 pt-3">
                                  <Label className="text-xs font-semibold text-slate-700">{getTranslation("manage.restaurantForm.repeatOn")}</Label>
                                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                                    {dayNames.map(({ value, key }) => (
                                      <label key={value} htmlFor={`notice-${index}-day-${value}`} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300">
                                        <Checkbox
                                          id={`notice-${index}-day-${value}`}
                                          checked={(notice.recurring_days ?? []).includes(value)}
                                          onCheckedChange={(checked) => toggleRecurringNoticeDay(index, value, checked as boolean)}
                                        />
                                        {getTranslation(key).slice(0, 3)}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
                                  <div className="space-y-1.5">
                                    <Label htmlFor={`notice-start-${index}`}>{getTranslation("manage.restaurantForm.startDate")}</Label>
                                    <Input
                                      id={`notice-start-${index}`}
                                      type="date"
                                      value={notice.start_date}
                                      onChange={(e) => updateReservationNotice(index, { start_date: e.target.value })}
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label htmlFor={`notice-end-${index}`}>{getTranslation("manage.restaurantForm.endDate")}</Label>
                                    <Input
                                      id={`notice-end-${index}`}
                                      type="date"
                                      value={notice.end_date}
                                      onChange={(e) => updateReservationNotice(index, { end_date: e.target.value })}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="mt-3 space-y-3">
                              <div className="space-y-1.5">
                                <Label htmlFor={`notice-title-${index}`}>{getTranslation("manage.restaurantForm.title")}</Label>
                              <Input
                                id={`notice-title-${index}`}
                                value={notice.title}
                                placeholder={getTranslation("manage.restaurantForm.titlePlaceholder")}
                                onChange={(e) => updateReservationNotice(index, { title: e.target.value })}
                              />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor={`notice-message-${index}`}>{getTranslation("manage.restaurantForm.message")}</Label>
                              <Textarea
                                id={`notice-message-${index}`}
                                value={notice.message}
                                placeholder={getTranslation("manage.restaurantForm.messagePlaceholder")}
                                rows={2}
                                onChange={(e) => updateReservationNotice(index, { message: e.target.value })}
                              />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm font-semibold text-slate-800">{getTranslation("manage.restaurantForm.blockedWindows")}</Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {getTranslation("manage.restaurantForm.blockedDescription")}
                        </p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addBlockedInterval} className="shrink-0 rounded-lg border-slate-200 bg-white text-xs">
                        {getTranslation("manage.restaurantForm.addWindow")}
                      </Button>
                    </div>

                    {formData.reservation_blocked_intervals.length > 0 && (
                      <div className="space-y-2.5">
                        {formData.reservation_blocked_intervals.map((interval, index) => (
                          <div key={index} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><Clock3 className="h-3.5 w-3.5" /></span>
                                {getTranslation("manage.restaurantForm.blockedWindow", { number: String(index + 1) })}
                              </div>
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeBlockedInterval(index)} className="h-7 w-7 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={getTranslation("manage.restaurantForm.removeWindow", { number: String(index + 1) })}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="space-y-1.5">
                                <Label htmlFor={`blocked-date-${index}`}>{getTranslation("manage.restaurantForm.date")}</Label>
                                <Input
                                  id={`blocked-date-${index}`}
                                  type="date"
                                  value={interval.date}
                                  onChange={(e) => updateBlockedInterval(index, { date: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor={`blocked-start-${index}`}>{getTranslation("manage.restaurantForm.startTime")}</Label>
                                <Input
                                  id={`blocked-start-${index}`}
                                  type="time"
                                  step="900"
                                  value={interval.start_time}
                                  onChange={(e) => updateBlockedInterval(index, { start_time: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor={`blocked-end-${index}`}>{getTranslation("manage.restaurantForm.endTime")}</Label>
                                <Input
                                  id={`blocked-end-${index}`}
                                  type="time"
                                  step="900"
                                  value={interval.end_time === "24:00" ? "23:59" : interval.end_time}
                                  onChange={(e) => updateBlockedInterval(index, { end_time: e.target.value })}
                                />
                                <label htmlFor={`blocked-midnight-${index}`} className="flex cursor-pointer items-center gap-1.5 pt-1 text-xs font-medium text-slate-500">
                                  <Checkbox
                                    id={`blocked-midnight-${index}`}
                                    checked={interval.end_time === "24:00"}
                                    onCheckedChange={(checked) => updateBlockedInterval(index, { end_time: checked ? "24:00" : "23:59" })}
                                  />
                                  {getTranslation("manage.restaurantForm.endAtMidnight")}
                                </label>
                              </div>
                            </div>
                            <div className="mt-3 space-y-1.5">
                              <Label htmlFor={`blocked-message-${index}`}>{getTranslation("manage.restaurantForm.message")}</Label>
                              <Textarea
                                id={`blocked-message-${index}`}
                                value={interval.message}
                                placeholder={getTranslation("manage.restaurantForm.blockedMessagePlaceholder")}
                                rows={2}
                                onChange={(e) => updateBlockedInterval(index, { message: e.target.value })}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="areas" className="mt-0 space-y-4">
              {restaurant ? (
                <ReservationAreasForm
                  restaurant={{
                    ...formData,
                    id: restaurant.id,
                    workspace_id: restaurant.workspace_id ?? null,
                    slug: restaurant.slug,
                    logo_url: restaurant.logo_url,
                    primary_image_url: restaurant.primary_image_url,
                    whatsapp: restaurant.whatsapp,
                    menu_url: restaurant.menu_url,
                    location_url: restaurant.location_url,
                    events_url: restaurant.events_url,
                    social_links: restaurant.social_links,
                    profile_visibility: restaurant.profile_visibility,
                    timezone: restaurant.timezone,
                    language: restaurant.language,
                    status: restaurant.status,
                    platform_status: restaurant.platform_status,
                    created_at: restaurant.created_at,
                    updated_at: restaurant.updated_at,
                    address_line1: null,
                    address_line2: null,
                    address_locality: null,
                    address_region: null,
                    address_postal_code: null,
                    address_country: null,
                    latitude: null,
                    longitude: null,
                    official_website_url: null,
                    required_guest_fields: ["name", "phone"],
                    optional_guest_fields: ["email", "notes"],
                    discovery_has_banner: false,
                    discovery_has_business_email: false,
                    discovery_score: 0,
                    reservation_blocked_intervals: formData.reservation_blocked_intervals as any,
                    reservation_notices: formData.reservation_notices as any,
                    blocked_dates: [],
                    special_hours: null
                  }}
                  areas={reservationAreas}
                  onAreasChange={handleAreasChange}
                />
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <p>{getTranslation("manage.restaurantForm.saveFirst")}</p>
                </div>
              )}
            </TabsContent>

            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
              <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-3 w-3" /></span>
                {getTranslation("manage.restaurantForm.changesSaved")}
              </div>
              <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="h-10 rounded-xl border-slate-200 px-4">
                {getTranslation("manage.restaurantForm.cancel")}
              </Button>
              <Button type="submit" loading={isLoading} className="h-10 rounded-xl bg-slate-900 px-4 text-white hover:bg-slate-800">
                {isLoading ? getTranslation("manage.restaurantForm.saving") : restaurant ? getTranslation("manage.restaurantForm.update") : getTranslation("manage.restaurantForm.create")}
              </Button>
              </div>
            </div>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
