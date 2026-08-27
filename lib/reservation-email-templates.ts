import "server-only"

import { getEmailMessages, interpolateEmail } from "@/i18n/email-messages"
import { resolveLanguage } from "@/i18n/config"
import { getConfiguredAppDomain } from "@/lib/domains/hostname"
import { escapeHtml, renderEmailActionLinks, renderEmailDetails, renderEmailNotice, renderReserveviaEmail } from "@/lib/email-template"

function managementOrigin() {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configuredAppUrl) {
    try {
      return new URL(configuredAppUrl).origin
    } catch {
      // Fall through to the configured app host.
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const localSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
    if (localSiteUrl) {
      try {
        return new URL(localSiteUrl).origin
      } catch {
        // Fall through to the configured app host.
      }
    }
  }

  return `https://${getConfiguredAppDomain()}`
}

function managementReservationUrl(reservationId: string) {
  return `${managementOrigin()}/manage/reservations?reservationId=${encodeURIComponent(reservationId)}`
}

function reservationDetails({
  restaurantName,
  reservationAreaName,
  reservationDate,
  reservationTime,
  partySize,
  reservationType,
  labels,
}: {
  restaurantName: string
  reservationAreaName?: string | null
  reservationDate: string
  reservationTime: string
  partySize: number | string
  reservationType?: string
  labels: {
    restaurant: string
    area: string
    date: string
    time: string
    partySize: string
    type: string
    dining: string
    drinks: string
  }
}) {
  return renderEmailDetails([
    { label: labels.restaurant, value: restaurantName },
    ...(reservationAreaName ? [{ label: labels.area, value: reservationAreaName }] : []),
    { label: labels.date, value: reservationDate },
    { label: labels.time, value: reservationTime },
    { label: labels.partySize, value: String(partySize) },
    ...(reservationType ? [{ label: labels.type, value: reservationType === "meal" ? labels.dining : labels.drinks }] : []),
  ])
}

export function generateReservationConfirmationEmail({
  customerName,
  restaurantName,
  reservationAreaName,
  reservationDate,
  reservationTime,
  partySize,
  reservationType,
  manageUrl,
  lang = "en",
}: {
  customerName: string
  restaurantName: string
  reservationAreaName?: string | null
  reservationDate: string
  reservationTime: string
  partySize: number | string
  reservationType?: string
  manageUrl?: string
  lang?: string
}) {
  const language = resolveLanguage(lang)
  const copy = getEmailMessages(language)
  const confirmation = copy.reservation.confirmation
  const labels = copy.reservation.labels
  const safeName = escapeHtml(customerName)
  const safeRestaurant = escapeHtml(restaurantName)
  const replacements = {
    customer: safeName,
    restaurant: safeRestaurant,
    customerPlain: customerName,
    restaurantPlain: restaurantName,
    dateLabel: labels.date,
    timeLabel: labels.time,
    partyLabel: labels.partySize,
    date: reservationDate,
    time: reservationTime,
    party: String(partySize),
  }

  const html = renderReserveviaEmail({
    lang: language,
    preheader: interpolateEmail(confirmation.preheader, { restaurant: restaurantName }),
    eyebrow: confirmation.eyebrow,
    title: confirmation.title,
    intro: interpolateEmail(confirmation.intro, replacements),
    content: `${reservationDetails({ restaurantName, reservationAreaName, reservationDate, reservationTime, partySize, reservationType, labels })}<div style="margin-top:18px">${renderEmailNotice(confirmation.nextTitle, confirmation.nextBody, "violet")}</div>`,
    cta: manageUrl ? { label: confirmation.manageCta, href: manageUrl } : undefined,
    footerNote: manageUrl ? confirmation.footer : confirmation.fallbackFooter,
  })
  const subject = interpolateEmail(confirmation.subject, { restaurant: restaurantName })
  const text = `${interpolateEmail(confirmation.text, replacements)}${manageUrl ? `\n\n${confirmation.manageCta}: ${manageUrl}` : ""}`

  return { subject, html, text }
}

export function generateManagementNotificationEmail({
  action,
  customerName,
  restaurantName,
  reservationAreaName,
  reservationDate,
  reservationTime,
  partySize,
  customerEmail,
  customerPhone,
  specialRequests,
  reservationId,
  reservationType,
  lang = "en",
}: {
  action: "created" | "updated"
  customerName: string
  restaurantName: string
  reservationAreaName?: string | null
  reservationDate: string
  reservationTime: string
  partySize: number | string
  customerEmail: string
  customerPhone: string
  specialRequests?: string
  reservationId: string
  reservationType?: string
  lang?: string
}) {
  const language = resolveLanguage(lang)
  const copy = getEmailMessages(language)
  const management = copy.management
  const labels = copy.reservation.labels
  const isNew = action === "created"
  const safeRestaurant = escapeHtml(restaurantName)
  const content = `${reservationDetails({ restaurantName, reservationAreaName, reservationDate, reservationTime, partySize, reservationType, labels })}<div style="margin-top:18px">${renderEmailDetails([
    { label: management.guest, value: customerName },
    { label: management.email, value: customerEmail },
    { label: management.phone, value: customerPhone },
    ...(specialRequests ? [{ label: management.guestNote, value: specialRequests }] : []),
  ])}</div><div style="margin-top:18px">${renderEmailNotice(management.pendingReview, isNew ? management.pendingCreated : management.pendingUpdated, "amber")}</div>`
  const subjectTemplate = isNew ? management.subjectCreated : management.subjectUpdated
  const textHeader = isNew ? management.textHeaderCreated : management.textHeaderUpdated

  const html = renderReserveviaEmail({
    lang: language,
    preheader: interpolateEmail(isNew ? management.preheaderCreated : management.preheaderUpdated, { restaurant: restaurantName }),
    eyebrow: isNew ? management.eyebrowCreated : management.eyebrowUpdated,
    title: isNew ? management.titleCreated : management.titleUpdated,
    intro: interpolateEmail(management.intro, { restaurant: safeRestaurant }),
    content,
    cta: { label: management.cta, href: managementReservationUrl(reservationId) },
    footerNote: management.footer,
  })
  const subject = interpolateEmail(subjectTemplate, { restaurant: restaurantName })
  const text = interpolateEmail(management.text, {
    header: textHeader,
    restaurantPlain: restaurantName,
    customerPlain: customerName,
    emailPlain: customerEmail,
    phonePlain: customerPhone,
    date: reservationDate,
    time: reservationTime,
    party: String(partySize),
    url: managementReservationUrl(reservationId),
  })

  return { subject, html, text }
}

export function generateStatusUpdateEmail({
  customerName,
  restaurantName,
  reservationAreaName,
  reservationDate,
  reservationTime,
  partySize,
  status,
  notes,
  reservationType,
  manageUrl,
  lang = "en",
}: {
  customerName: string
  restaurantName: string
  reservationAreaName?: string | null
  reservationDate: string
  reservationTime: string
  partySize: number | string
  status: "confirmed" | "cancelled"
  notes?: string
  reservationType?: string
  manageUrl?: string
  lang?: string
}) {
  const language = resolveLanguage(lang)
  const copy = getEmailMessages(language)
  const statusCopy = copy.reservation.status
  const labels = copy.reservation.labels
  const isConfirmed = status === "confirmed"
  const safeName = escapeHtml(customerName)
  const safeRestaurant = escapeHtml(restaurantName)
  const intro = isConfirmed ? statusCopy.introConfirmed : statusCopy.introCancelled
  const replacements = {
    customer: safeName,
    restaurant: safeRestaurant,
    restaurantPlain: restaurantName,
    date: reservationDate,
    time: reservationTime,
    party: String(partySize),
  }
  const html = renderReserveviaEmail({
    lang: language,
    preheader: interpolateEmail(isConfirmed ? statusCopy.preheaderConfirmed : statusCopy.preheaderCancelled, { restaurant: restaurantName }),
    eyebrow: isConfirmed ? statusCopy.eyebrowConfirmed : statusCopy.eyebrowCancelled,
    title: isConfirmed ? statusCopy.titleConfirmed : statusCopy.titleCancelled,
    accentColor: isConfirmed ? "#059669" : "#e11d48",
    intro: interpolateEmail(intro, replacements),
    content: `${notes ? `<div style="margin-bottom:18px">${renderEmailNotice(statusCopy.noteTitle, escapeHtml(notes), isConfirmed ? "green" : "rose")}</div>` : ""}${reservationDetails({ restaurantName, reservationAreaName, reservationDate, reservationTime, partySize, reservationType, labels })}`,
    cta: manageUrl ? { label: statusCopy.manageCta, href: manageUrl } : undefined,
    footerNote: isConfirmed
      ? (manageUrl ? statusCopy.footerConfirmed : statusCopy.footerConfirmedFallback)
      : statusCopy.footerCancelled,
  })
  const subject = interpolateEmail(isConfirmed ? statusCopy.subjectConfirmed : statusCopy.subjectCancelled, { restaurant: restaurantName })
  const statusText = interpolateEmail(isConfirmed ? statusCopy.textConfirmed : statusCopy.textCancelled, replacements)
  const text = `${statusText}\n\n${labels.date}: ${reservationDate}\n${labels.time}: ${reservationTime}\n${labels.partySize}: ${partySize}${notes ? `\n\n${statusCopy.textNoteLabel}: ${notes}` : ""}${manageUrl ? `\n\n${statusCopy.manageCta}: ${manageUrl}` : ""}`

  return { subject, html, text }
}

export function generateUnclaimedBusinessReservationEmail({
  customerName,
  restaurantName,
  reservationAreaName,
  reservationDate,
  reservationTime,
  partySize,
  reservationType,
  specialRequests,
  manageUrl,
  claimUrl,
  publicUrl,
  lang = "en",
}: {
  customerName: string
  restaurantName: string
  reservationAreaName?: string | null
  reservationDate: string
  reservationTime: string
  partySize: number | string
  reservationType?: string
  specialRequests?: string | null
  manageUrl: string
  claimUrl: string
  publicUrl: string
  lang?: string
}) {
  const language = resolveLanguage(lang)
  const copy = getEmailMessages(language)
  const acquisition = copy.acquisition
  const labels = copy.reservation.labels
  const safeRestaurant = escapeHtml(restaurantName)
  const details = renderEmailDetails([
    { label: acquisition.guest, value: customerName },
    ...((reservationAreaName ? [{ label: labels.area, value: reservationAreaName }] : []) as { label: string; value: string }[]),
    { label: labels.date, value: reservationDate },
    { label: labels.time, value: reservationTime },
    { label: labels.partySize, value: String(partySize) },
    ...(reservationType ? [{ label: labels.type, value: reservationType === "meal" ? labels.dining : labels.drinks }] : []),
    ...(specialRequests ? [{ label: acquisition.specialRequests, value: specialRequests }] : []),
  ])
  const html = renderReserveviaEmail({
    lang: language,
    preheader: interpolateEmail(acquisition.preheader, { restaurant: restaurantName }),
    eyebrow: acquisition.eyebrow,
    title: acquisition.title,
    accentColor: "#d97706",
    intro: interpolateEmail(acquisition.intro, { restaurant: safeRestaurant }),
    content: `${details}<div style="margin-top:18px">${renderEmailNotice(acquisition.pending, acquisition.pending, "amber")}</div><div style="margin-top:18px">${renderEmailNotice("Reservevia", acquisition.claimNote, "violet")}</div>${renderEmailActionLinks([{ label: acquisition.claim, href: claimUrl }, { label: acquisition.view, href: publicUrl }])}`,
    cta: { label: acquisition.manage, href: manageUrl },
    footerNote: acquisition.footer,
  })
  const subject = interpolateEmail(acquisition.subject, { restaurant: restaurantName })
  const text = interpolateEmail(acquisition.text, {
    restaurantPlain: restaurantName,
    customerPlain: customerName,
    date: reservationDate,
    time: reservationTime,
    party: String(partySize),
    areaLabel: labels.area,
    area: reservationAreaName || "—",
    typeLabel: labels.type,
    type: reservationType === "meal" ? labels.dining : reservationType === "drinks" ? labels.drinks : "—",
    specialRequestsLabel: acquisition.specialRequests,
    specialRequests: specialRequests || "—",
    pending: acquisition.pending,
    manageUrl,
    claimUrl,
    publicUrl,
  })
  return { subject, html, text }
}
