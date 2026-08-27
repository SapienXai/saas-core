'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { RestaurantForm } from '@/components/restaurant-form';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { getRestaurantCreationAccess, getRestaurants, deleteRestaurant, updateRestaurant } from '@/app/manage/actions';
import { useLanguage } from '@/context/language-context';
import { AlertTriangle, ArrowRight, Check, Copy, Facebook, Globe2, Instagram, Link2, Loader2, MessageCircle, MoreHorizontal, Edit, Trash2, Plus, Music2, Phone, Clock3, Store, Twitter, Youtube } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { OrbLoader } from '@/components/ui/orb-loader';
import { toast } from 'sonner';
import Image from 'next/image';
import Link from 'next/link';
import type { Database } from '@/types/supabase';
import { useManageContext } from '@/context/manage-context';
import { RestaurantUpgradeModal } from '@/components/manage/restaurant-upgrade-modal';
import { normalizeProfileVisibility, normalizeSocialLinks, type SocialPlatform } from '@/lib/restaurant-profile';
import { formatDate as formatLocalizedDate } from '@/i18n/format';

type Restaurant = Database['public']['Tables']['restaurants']['Row']

interface RestaurantWithMedia extends Restaurant {
  publicUrl?: string
  media?: {
    id: string
    url: string
    alt_text?: string
    media_url: string
  }[]
  planAccess?: {
    isLive: boolean
    scheduledForOffline: boolean
    offlineAt: string | null
    scheduledPlanName: string | null
  } | null
}

type RestaurantCreationAccess = {
  planName: string
  restaurantCount: number
  restaurantLimit: number | null
  reason: "restaurant_limit" | null
}

const MANAGED_SOCIAL_PLATFORMS: ReadonlyArray<{ platform: SocialPlatform; label: string; Icon: LucideIcon }> = [
  { platform: "instagram", label: "Instagram", Icon: Instagram },
  { platform: "facebook", label: "Facebook", Icon: Facebook },
  { platform: "tiktok", label: "TikTok", Icon: Music2 },
  { platform: "youtube", label: "YouTube", Icon: Youtube },
  { platform: "x", label: "X", Icon: Twitter },
  { platform: "website", label: "Website", Icon: Globe2 },
]

function formatDisplayText(value: string | null | undefined) {
  if (!value) return null
  const withSpaces = value.replace(/\+/g, " ")
  try {
    return decodeURIComponent(withSpaces)
  } catch {
    return withSpaces
  }
}

function formatReservationHours(restaurant: RestaurantWithMedia) {
  if (restaurant.opening_time && restaurant.closing_time) {
    return `${restaurant.opening_time.slice(0, 5)} - ${restaurant.closing_time.slice(0, 5)}`
  }
  return formatDisplayText(restaurant.hours)
}

function sortRestaurantsByStatus(items: RestaurantWithMedia[]) {
  return [...items].sort((a, b) => {
    const aEnabled = a.reservation_enabled ? 1 : 0
    const bEnabled = b.reservation_enabled ? 1 : 0
    if (aEnabled !== bEnabled) return bEnabled - aEnabled
    return a.name.localeCompare(b.name)
  })
}

export default function RestaurantsPage() {
  const [restaurants, setRestaurants] = useState<RestaurantWithMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingRestaurant, setEditingRestaurant] = useState<RestaurantWithMedia | undefined>(undefined);
  const [checkingCreationAccess, setCheckingCreationAccess] = useState(false);
  const [updatingReservationIds, setUpdatingReservationIds] = useState<Set<string>>(new Set())
  const [upgradeAccess, setUpgradeAccess] = useState<RestaurantCreationAccess | null>(null);
  const [brandLinkCopied, setBrandLinkCopied] = useState(false)
  const { role, loading: roleLoading, currentWorkspace, ownedWorkspaceId } = useManageContext();
  const { currentLang, getTranslation, translateMessage } = useLanguage();
  const { showConfirmation, ConfirmationDialogComponent } = useConfirmationDialog();
  const router = useRouter();
  const canCreateRestaurant = role === 'owner' || role === 'admin';
  const canUseBrandLink = Boolean(
    currentWorkspace?.publicBrandUrl &&
    currentWorkspace.plan?.features?.multiRestaurant &&
    ['owner', 'admin'].includes(currentWorkspace.role) &&
    restaurants.length > 1
  )

  const fetchRestaurants = async () => {
    setLoadError(false);
    try {
      const result = await getRestaurants();
      if (result.success && Array.isArray(result.data)) {
        setRestaurants(sortRestaurantsByStatus(result.data as RestaurantWithMedia[]));
      } else {
        setLoadError(true);
      }
    } catch (error) {
      console.error('Error fetching restaurants:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!roleLoading) void fetchRestaurants();
  }, [roleLoading]);

  const handleBookingSettings = (restaurant: RestaurantWithMedia) => {
    setEditingRestaurant(restaurant);
    setShowForm(true);
  };

  const handleAddRestaurant = async () => {
    setCheckingCreationAccess(true)
    try {
      const result = await getRestaurantCreationAccess(currentWorkspace?.id || undefined)
      if (!result.success || !result.data) {
        toast.error(translateMessage(result.message || getTranslation("manage.restaurants.statusUpdateFailed")))
        return
      }

      if (!result.data.canCreate) {
        setUpgradeAccess({
          planName: result.data.planName,
          restaurantCount: result.data.restaurantCount,
          restaurantLimit: result.data.restaurantLimit,
          reason: result.data.reason,
        })
        return
      }

      router.push("/onboarding/new")
    } finally {
      setCheckingCreationAccess(false)
    }
  }

  const handleDelete = async (id: string, restaurantName: string) => {
    showConfirmation({
      title: getTranslation("manage.restaurants.delete"),
      description: getTranslation("manage.restaurants.deleteDescription", { restaurant: restaurantName }),
      confirmText: getTranslation("manage.restaurants.delete"),
      cancelText: getTranslation("recentReservation.actions.cancel"),
      variant: 'destructive',
      requireTextConfirmation: true,
      confirmationText: 'delete',
      onConfirm: async () => {
        const result = await deleteRestaurant(id);
        if (result.success) {
          toast.success(translateMessage(result.message));
          fetchRestaurants();
        } else {
          toast.error(translateMessage(result.message));
        }
      }
    });
  };

  const handleFormSuccess = () => {
    fetchRestaurants();
    setShowForm(false);
    setEditingRestaurant(undefined);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingRestaurant(undefined);
  };

  const handleToggleReservationEnabled = async (restaurant: RestaurantWithMedia, enabled: boolean) => {
    if (restaurant.planAccess?.isLive === false) return
    setUpdatingReservationIds((prev) => new Set(prev).add(restaurant.id))
    try {
      const result = await updateRestaurant(restaurant.id, { reservation_enabled: enabled })
      if (result.success) {
        setRestaurants((prev) =>
          sortRestaurantsByStatus(
            prev.map((item) => (item.id === restaurant.id ? { ...item, reservation_enabled: enabled } : item))
          )
        )
        toast.success(
          enabled
            ? getTranslation('manage.restaurants.statusEnabled')
            : getTranslation('manage.restaurants.statusDisabled')
        )
      } else {
        toast.error(translateMessage(result.message || getTranslation('manage.restaurants.statusUpdateFailed')))
      }
    } finally {
      setUpdatingReservationIds((prev) => {
        const next = new Set(prev)
        next.delete(restaurant.id)
        return next
      })
    }
  }

  const copyBrandLink = async () => {
    const brandUrl = currentWorkspace?.publicBrandUrl
    if (!brandUrl) return
    try {
      await navigator.clipboard.writeText(brandUrl)
      setBrandLinkCopied(true)
      window.setTimeout(() => setBrandLinkCopied(false), 1800)
    } catch {
      toast.error(getTranslation("manage.domains.messageCopyFailed"))
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] pb-10">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">{getTranslation('manage.restaurants.title')}</h1>
        </div>
        {canCreateRestaurant && (
        <Button onClick={() => void handleAddRestaurant()} loading={checkingCreationAccess} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          {getTranslation("manage.restaurants.addRestaurant")}
        </Button>
        )}
      </div>

      {canUseBrandLink && currentWorkspace?.publicBrandUrl ? (
        <section className="mb-6 flex flex-col gap-4 rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 to-indigo-50 p-4 shadow-sm dark:border-violet-400/20 dark:from-violet-500/[0.08] dark:to-indigo-500/[0.08] sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-labelledby="manage-brand-link-title">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm shadow-violet-600/20"><Link2 aria-hidden="true" /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">{getTranslation("manage.restaurants.brandLinkEyebrow")}</p>
              <h2 id="manage-brand-link-title" className="mt-1 text-base font-bold tracking-tight text-slate-950 dark:text-white">{getTranslation("manage.restaurants.brandLinkTitle")}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-600 dark:text-slate-300">{getTranslation("manage.restaurants.brandLinkDescription", { count: restaurants.length })}</p>
              <code className="mt-2 block max-w-full truncate text-xs font-semibold text-violet-800 dark:text-violet-200" title={currentWorkspace.publicBrandUrl}>{currentWorkspace.publicBrandUrl}</code>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => void copyBrandLink()} className="h-10 gap-2 rounded-xl border-violet-200 bg-white font-bold text-violet-800 hover:bg-violet-50 dark:border-violet-400/20 dark:bg-white/[0.06] dark:text-violet-100 dark:hover:bg-violet-500/10">
              {brandLinkCopied ? <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {brandLinkCopied ? getTranslation("manage.restaurants.brandLinkCopied") : getTranslation("manage.restaurants.copyBrandLink")}
            </Button>
            <Button asChild type="button" className="h-10 gap-2 rounded-xl bg-violet-600 font-bold text-white shadow-sm shadow-violet-600/20 hover:bg-violet-700">
              <a href={currentWorkspace.publicBrandUrl} target="_blank" rel="noreferrer noopener"><Globe2 className="h-4 w-4" aria-hidden="true" />{getTranslation("manage.restaurants.openBrandLink")}</a>
            </Button>
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-slate-200/80 bg-white/70 dark:border-white/10 dark:bg-white/[0.03]" aria-busy="true">
          <OrbLoader label={getTranslation('manage.common.loadingRestaurants')} state="searching" />
        </div>
      ) : loadError ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-rose-200/80 bg-rose-50/60 px-6 text-center dark:border-rose-400/20 dark:bg-rose-500/[0.06]">
          <AlertTriangle className="h-8 w-8 text-rose-500" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">{getTranslation('manage.common.restaurantsLoadError')}</h2>
          <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300">{getTranslation('manage.common.restaurantAccessRequired')}</p>
          <Button onClick={() => { setLoading(true); void fetchRestaurants() }} className="mt-5">{getTranslation('manage.common.refreshData')}</Button>
        </div>
      ) : (
        <div className="manage-restaurant-grid">
          {restaurants.map((restaurant) => {
          const coverUrl = restaurant.primary_image_url || restaurant.media?.[0]?.media_url || null
          const visibility = normalizeProfileVisibility(restaurant.profile_visibility)
          const socialLinks = normalizeSocialLinks(restaurant.social_links)
          const visibleSocialLinks = MANAGED_SOCIAL_PLATFORMS.filter(({ platform }) => visibility.social && Boolean(socialLinks[platform]))
          const phoneNumber = visibility.phone ? restaurant.phone : null
          const whatsappNumber = visibility.whatsapp ? (restaurant.whatsapp || (visibility.phone ? restaurant.phone : null))?.replace(/\D/g, "") : null
          const publicHref = restaurant.publicUrl || `/r/${restaurant.slug}`
          const isPlanLive = restaurant.planAccess?.isLive !== false
          const isScheduledForOffline = restaurant.planAccess?.scheduledForOffline === true
          const offlineAt = restaurant.planAccess?.offlineAt || null
          const offlineDateValue = offlineAt && /^\d{4}-\d{2}-\d{2}$/.test(offlineAt)
            ? `${offlineAt}T12:00:00`
            : offlineAt
          const planOfflineDate = offlineDateValue
            ? formatLocalizedDate(offlineDateValue, currentLang, { dateStyle: "medium" }) || null
            : null
          const isUpdatingReservation = updatingReservationIds.has(restaurant.id)
          const reservationHours = formatReservationHours(restaurant) || getTranslation("manage.restaurants.hoursNotSet")
            return (
            <article key={restaurant.id} className="public-restaurant-card manage-restaurant-card">
            <div className="public-restaurant-card-image-link">
              {coverUrl ? (
                coverUrl.endsWith('.mp4') || coverUrl.endsWith('.webm') || coverUrl.endsWith('.mov') ? (
                  <video
                    src={coverUrl}
                    className="public-restaurant-card-image"
                    autoPlay
                    muted
                    loop
                    playsInline
                  />
                ) : (
                  <Image
                    src={coverUrl}
                    alt={restaurant.name}
                    fill
                    unoptimized
                    className="public-restaurant-card-image"
                  />
                )
              ) : (
                <div className="public-restaurant-card-image public-restaurant-card-image-empty">
                  <span>{restaurant.name.slice(0, 1).toUpperCase()}</span>
                  <small className="manage-restaurant-card-empty-label">{getTranslation("manage.restaurants.noMedia")}</small>
                </div>
              )}
              <div className="public-restaurant-card-image-shade" />
            </div>

            <div className="public-restaurant-card-overlay">
              {(isScheduledForOffline && planOfflineDate) || !isPlanLive ? (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/95 px-3 py-2 text-xs font-semibold text-amber-950 shadow-sm dark:border-amber-300/20 dark:bg-slate-950/90 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {isPlanLive && planOfflineDate
                      ? getTranslation("manage.restaurants.planLiveUntil", { date: planOfflineDate })
                      : getTranslation("manage.restaurants.planOffline")}
                  </span>
                </div>
              ) : null}
              <div className="public-restaurant-card-top manage-restaurant-card-top">
                <div className="manage-restaurant-card-reservation-toggle">
                  <span className={isPlanLive && restaurant.reservation_enabled ? "is-enabled" : "is-disabled"}>
                    <span className="manage-restaurant-card-status-dot" />
                    {!isPlanLive
                      ? getTranslation("manage.restaurants.planOffline")
                      : restaurant.reservation_enabled ? getTranslation("manage.restaurants.on") : getTranslation("manage.restaurants.off")}
                  </span>
                  <span className="manage-restaurant-card-switch-control">
                    <Switch
                      checked={isPlanLive && Boolean(restaurant.reservation_enabled)}
                      onCheckedChange={(checked) => void handleToggleReservationEnabled(restaurant, checked)}
                      disabled={!canCreateRestaurant || isUpdatingReservation || !isPlanLive}
                      aria-label={getTranslation("manage.restaurants.reservationStatus")}
                    />
                    {isUpdatingReservation && <Loader2 className="manage-restaurant-card-status-loader" aria-label={getTranslation("manage.common.loadingRestaurants")} />}
                  </span>
                </div>

                <div className="manage-restaurant-card-top-actions">
                  {(phoneNumber || whatsappNumber) && (
                    <div className="public-restaurant-card-contact-actions" aria-label={getTranslation("public.contactOptions", { restaurant: restaurant.name })}>
                      {whatsappNumber && (
                        <a
                          href={`https://wa.me/${whatsappNumber}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="public-restaurant-card-contact public-restaurant-card-contact-whatsapp"
                          aria-label={getTranslation("public.messageOnWhatsapp", { restaurant: restaurant.name })}
                        >
                          <MessageCircle aria-hidden="true" />
                        </a>
                      )}
                      {phoneNumber && (
                        <a href={`tel:${phoneNumber}`} className="public-restaurant-card-contact public-restaurant-card-contact-phone" aria-label={getTranslation("public.callRestaurant", { restaurant: restaurant.name })}>
                          <Phone aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="manage-restaurant-card-menu-trigger" aria-label={`${restaurant.name} ${getTranslation("manage.reservations.card.actions")}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {role !== 'staff' && role !== 'readonly' && (
                        <DropdownMenuItem asChild className="text-slate-700">
                          <Link href={`/manage/restaurants/${restaurant.id}/profile`}>
                            <Edit className="mr-2 h-4 w-4" />
                            {getTranslation("manage.restaurants.editRestaurant")}
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {canCreateRestaurant && (
                        <>
                          <DropdownMenuItem onClick={() => handleBookingSettings(restaurant)} className="text-blue-600">
                            <Clock3 className="mr-2 h-4 w-4" />
                            {getTranslation("manage.restaurants.reservationSettings")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete(restaurant.id, restaurant.name)} className="text-red-600">
                            <Trash2 className="mr-2 h-4 w-4" />
                            {getTranslation("manage.restaurants.delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="public-restaurant-card-bottom">
                <div className="manage-restaurant-card-identity">
                  {restaurant.logo_url && (
                    <div className="manage-restaurant-card-logo">
                      <Image
                        src={restaurant.logo_url}
                        alt={getTranslation("public.restaurantLogo", { restaurant: restaurant.name })}
                        width={48}
                        height={48}
                        unoptimized
                        className="h-full w-full object-contain p-1"
                      />
                    </div>
                  )}
                  <div className="public-restaurant-card-title">
                    <p className="public-restaurant-card-eyebrow">{getTranslation("public.reserveviaDining")}</p>
                    <h2>{restaurant.name}</h2>
                    {restaurant.description && <p>{formatDisplayText(restaurant.description)}</p>}
                  </div>
                </div>

                <div className="public-restaurant-card-info" aria-label={getTranslation("public.restaurantDetails", { restaurant: restaurant.name })}>
                  {restaurant.cuisine && <div><span>{getTranslation("onboarding.cuisine" as never)}</span><strong>{formatDisplayText(restaurant.cuisine)}</strong></div>}
                  {restaurant.location && <div><span>{getTranslation("marketing.locationAddress" as never)}</span><strong>{formatDisplayText(restaurant.location)}</strong></div>}
                  <div><span>{getTranslation("manage.restaurants.reservationHours")}</span><strong>{reservationHours}</strong></div>
                </div>

                <div className="public-restaurant-card-actions manage-restaurant-card-actions">
                  {role !== 'staff' && role !== 'readonly' && (
                    <Link href={`/manage/restaurants/${restaurant.id}/profile`} className="manage-restaurant-card-primary">
                      <span>{getTranslation("manage.restaurants.editRestaurant")}</span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  )}
                  <div className="public-restaurant-card-secondary-actions manage-restaurant-card-secondary-actions">
                    {isPlanLive ? (
                      <a href={publicHref} target="_blank" rel="noreferrer" className="public-restaurant-card-action">
                        <Globe2 aria-hidden="true" />
                        <span>{getTranslation("manage.restaurants.viewPublicPage")}</span>
                      </a>
                    ) : (
                      <span className="public-restaurant-card-action opacity-60" aria-disabled="true">
                        <Globe2 aria-hidden="true" />
                        <span>{getTranslation("manage.restaurants.planOffline")}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="public-restaurant-card-footer manage-restaurant-card-footer">
                  <div className="manage-restaurant-card-publish-status">
                    <span className={isPlanLive && restaurant.status === 'published' ? "is-published" : "is-unpublished"} />
                    <span>{!isPlanLive ? getTranslation("manage.restaurants.planOffline") : restaurant.status === 'published' ? getTranslation("manage.restaurants.published") : getTranslation("manage.restaurants.unpublished")}</span>
                    {isPlanLive && <a href={publicHref} target="_blank" rel="noreferrer noopener" className="manage-restaurant-card-public-link" title={publicHref}>
                      {publicHref}
                    </a>}
                  </div>
                  {visibleSocialLinks.length > 0 && (
                    <div className="public-restaurant-card-social" aria-label={getTranslation("public.contactOptions", { restaurant: restaurant.name })}>
                      {visibleSocialLinks.map(({ platform, label, Icon }) => (
                        <a
                          key={platform}
                          href={socialLinks[platform]}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="public-restaurant-card-social-link"
                          aria-label={getTranslation("public.socialProfile", { restaurant: restaurant.name, profile: label })}
                          title={label}
                        >
                          <Icon aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </article>
            )
          })}
        </div>
      )}

      {!loading && !loadError && restaurants.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white/70 px-6 py-14 text-center dark:border-white/10 dark:bg-white/[0.03]">
          <Store className="h-9 w-9 text-violet-500" aria-hidden="true" />
          <p className="mt-4 max-w-md text-sm text-slate-600 dark:text-slate-300">{canCreateRestaurant ? getTranslation('manage.common.noWorkspaceRestaurants') : getTranslation('manage.common.noAssignedRestaurants')}</p>
          {canCreateRestaurant && <Button onClick={() => void handleAddRestaurant()} loading={checkingCreationAccess} className="mt-5"><Plus className="h-4 w-4" />{getTranslation("manage.restaurants.addRestaurant")}</Button>}
        </div>
      )}
      
      {canCreateRestaurant && (
        <RestaurantForm
          restaurant={editingRestaurant || undefined}
          onSuccess={handleFormSuccess}
          onClose={handleFormClose}
          open={showForm}
        />
      )}
      <RestaurantUpgradeModal
        open={Boolean(upgradeAccess)}
        onOpenChange={(open) => {
          if (!open) setUpgradeAccess(null)
        }}
        currentPlan={upgradeAccess?.planName || "current"}
        restaurantCount={upgradeAccess?.restaurantCount || 0}
        restaurantLimit={upgradeAccess?.restaurantLimit ?? null}
        reason={upgradeAccess?.reason || null}
        currentWorkspaceId={currentWorkspace?.id}
        ownedWorkspaceId={ownedWorkspaceId}
      />
      {ConfirmationDialogComponent}
    </div>
  );
}
