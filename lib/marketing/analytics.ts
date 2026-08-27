export const MARKETING_EVENT_NAMES = [
  "marketing_page_view",
  "hero_start_free_click",
  "hero_demo_click",
  "hero_how_it_works_click",
  "pricing_plan_click",
  "final_cta_click",
  "signup_started",
  "signup_completed",
  "restaurant_created",
  "restaurant_published",
  "first_reservation_received",
] as const

export type MarketingEventName = (typeof MARKETING_EVENT_NAMES)[number]

export type MarketingEventProperties = {
  plan?: string
  source?: string
}

export type MarketingEventPayload = MarketingEventProperties & {
  event: MarketingEventName
}

export const MARKETING_EVENT = "reservevia:marketing"

function isBrowser() {
  return typeof window !== "undefined" && typeof window.dispatchEvent === "function"
}

export function trackMarketingEvent(name: MarketingEventName, properties: MarketingEventProperties = {}) {
  if (!isBrowser()) return

  const detail: MarketingEventPayload = {
    event: name,
    ...(properties.plan ? { plan: properties.plan } : {}),
    ...(properties.source ? { source: properties.source } : {}),
  }

  window.dispatchEvent(new CustomEvent(MARKETING_EVENT, { detail }))
}

export function subscribeMarketingEvents(listener: (payload: MarketingEventPayload) => void) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {}

  const handleEvent = (event: Event) => {
    const payload = (event as CustomEvent<MarketingEventPayload>).detail
    if (!payload || typeof payload.event !== "string") return
    try {
      listener(payload)
    } catch {
      // Analytics consumers must never affect the product flow.
    }
  }

  window.addEventListener(MARKETING_EVENT, handleEvent)
  return () => window.removeEventListener(MARKETING_EVENT, handleEvent)
}

export function trackMarketingEventOnce(name: MarketingEventName, storageKey: string, properties: MarketingEventProperties = {}) {
  if (!isBrowser()) return

  try {
    if (window.sessionStorage.getItem(storageKey)) return
    window.sessionStorage.setItem(storageKey, "1")
  } catch {
    // Tracking must never affect the product flow when storage is unavailable.
  }

  trackMarketingEvent(name, properties)
}
