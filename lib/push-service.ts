import webpush, { type PushSubscription } from "web-push"
import { getEffectivePwaBranding } from "@/lib/pwa"
import { can } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"

type ReservationPushEvent = "created" | "updated" | "cancelled"

type WorkspacePushSubscriptionRow = {
  id: string
  workspace_id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

type WorkspaceMembershipRow = {
  id: string
  user_id: string
  role: string
  restaurant_access_mode: "all" | "selected"
}

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "") || undefined
}

function getVapidConfig() {
  const publicKey = cleanEnvValue(process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY)
  const privateKey = cleanEnvValue(process.env.WEB_PUSH_PRIVATE_KEY)
  const subject = cleanEnvValue(process.env.WEB_PUSH_SUBJECT) || "mailto:support@reservevia.com"

  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject }
}

export function getWebPushPublicKey() {
  return cleanEnvValue(process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY) || null
}

export function isWebPushConfigured() {
  return Boolean(getVapidConfig())
}

function configureWebPush() {
  const config = getVapidConfig()
  if (!config) return false
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
  return true
}

export async function getPushRecipientsForRestaurant(restaurantId: string) {
  const supabase = createServiceRoleClient()
  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id, workspace_id, name")
    .eq("id", restaurantId)
    .maybeSingle()

  if (restaurantError || !restaurant?.workspace_id) return { restaurant: null, workspaceId: null, subscriptions: [] as WorkspacePushSubscriptionRow[] }
  if (!(await can(restaurant.workspace_id, "pushNotifications"))) {
    return { restaurant, workspaceId: restaurant.workspace_id, subscriptions: [] as WorkspacePushSubscriptionRow[] }
  }

  const { data: subscriptions } = await supabase
    .from("workspace_push_subscriptions")
    .select("id, workspace_id, user_id, endpoint, p256dh, auth")
    .eq("workspace_id", restaurant.workspace_id)
    .eq("status", "active")

  if (!subscriptions?.length) return { restaurant, workspaceId: restaurant.workspace_id, subscriptions: [] as WorkspacePushSubscriptionRow[] }

  const userIds = Array.from(new Set(subscriptions.map((subscription) => subscription.user_id)))
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("id, user_id, role, restaurant_access_mode")
    .eq("workspace_id", restaurant.workspace_id)
    .in("user_id", userIds)

  const memberRows = (memberships || []) as WorkspaceMembershipRow[]
  const selectedMemberIds = memberRows
    .filter((membership) => membership.restaurant_access_mode === "selected")
    .map((membership) => membership.id)
  const { data: assignments } = selectedMemberIds.length > 0
    ? await supabase
      .from("workspace_member_restaurants")
      .select("member_id, restaurant_id")
      .in("member_id", selectedMemberIds)
      .eq("restaurant_id", restaurantId)
    : { data: [] as Array<{ member_id: string; restaurant_id: string }> }
  const assignedMembers = new Set((assignments || []).map((assignment) => assignment.member_id))
  const memberByUser = new Map(memberRows.map((membership) => [membership.user_id, membership]))
  const seenEndpoints = new Set<string>()
  const eligible = (subscriptions as WorkspacePushSubscriptionRow[]).filter((subscription) => {
    const membership = memberByUser.get(subscription.user_id)
    if (!membership || membership.role === "readonly") return false
    const hasRestaurantAccess = membership.role === "owner" || membership.role === "admin" || membership.restaurant_access_mode === "all" || assignedMembers.has(membership.id)
    if (!hasRestaurantAccess || seenEndpoints.has(subscription.endpoint)) return false
    seenEndpoints.add(subscription.endpoint)
    return true
  })

  return { restaurant, workspaceId: restaurant.workspace_id, subscriptions: eligible }
}

function formatReservationDate(date: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(new Date(`${date}T00:00:00`))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
  return [part("weekday"), part("day"), part("month")].filter(Boolean).join(" ")
}

function getReservationNotificationTitle(event: ReservationPushEvent) {
  if (event === "cancelled") return "Canceled reservation"
  return event === "updated" ? "Updated reservation" : "New reservation"
}

function getReservationBookedByLabel(reservation: {
  booked_by_label?: string | null
  booked_by_user_id?: string | null
}) {
  const manualLabel = reservation.booked_by_label?.trim()
  if (manualLabel) return manualLabel
  return reservation.booked_by_user_id ? "Staff" : "Online"
}

export async function sendReservationPushNotification(reservationId: string, event: ReservationPushEvent) {
  if (!configureWebPush()) {
    console.warn("Web Push is not configured. Set WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY.")
    return
  }

  const supabase = createServiceRoleClient()
  const { data: reservation, error } = await supabase
    .from("reservations")
    .select("id, restaurant_id, party_size, reservation_date, reservation_time, booked_by_user_id, booked_by_label")
    .eq("id", reservationId)
    .single()
  if (error || !reservation) {
    console.error("Could not fetch reservation for push notification:", error)
    return
  }

  const resolved = await getPushRecipientsForRestaurant(reservation.restaurant_id)
  if (!resolved.workspaceId || !resolved.restaurant || resolved.subscriptions.length === 0) return

  const branding = await getEffectivePwaBranding(resolved.workspaceId)
  const payload = JSON.stringify({
    title: getReservationNotificationTitle(event),
    body: `${getReservationBookedByLabel(reservation)} · ${resolved.restaurant.name} · ${formatReservationDate(reservation.reservation_date)} · ${reservation.reservation_time.slice(0, 5)} · ${reservation.party_size} guests`,
    icon: branding.iconUrl,
    badge: branding.iconUrl,
    url: `/manage/reservations?restaurant=${encodeURIComponent(reservation.restaurant_id)}&reservationId=${encodeURIComponent(reservationId)}`,
    reservationId,
    event,
  })

  await Promise.all(resolved.subscriptions.map(async (subscription) => {
    const pushSubscription: PushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }

    try {
      await webpush.sendNotification(pushSubscription, payload)
    } catch (error: any) {
      const statusCode = error?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from("workspace_push_subscriptions")
          .update({ status: "revoked", revoked_at: new Date().toISOString() })
          .eq("id", subscription.id)
        return
      }
      console.error("Failed to send workspace push notification:", {
        workspaceId: resolved.workspaceId,
        subscriptionId: subscription.id,
        userId: subscription.user_id,
        statusCode,
      })
    }
  }))
}
