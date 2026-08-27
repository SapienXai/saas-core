"use client"

import { useEffect } from "react"
import { subscribeMarketingEvents, type MarketingEventPayload } from "@/lib/marketing/analytics"

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
    va?: (command: "event", payload: Record<string, string>) => void
    posthog?: {
      capture: (eventName: string, properties?: Record<string, string>) => void
    }
  }
}

function getProperties(payload: MarketingEventPayload) {
  return {
    ...(payload.plan ? { plan: payload.plan } : {}),
    ...(payload.source ? { source: payload.source } : {}),
  }
}

function forwardMarketingEvent(payload: MarketingEventPayload) {
  const properties = getProperties(payload)

  try {
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: "reservevia_marketing", reservevia_event: payload.event, ...properties })
    }
  } catch {
    // Analytics consumers must never affect the product flow.
  }
  try {
    window.va?.("event", { name: payload.event, ...properties })
  } catch {
    // Analytics consumers must never affect the product flow.
  }
  try {
    window.posthog?.capture(payload.event, properties)
  } catch {
    // Analytics consumers must never affect the product flow.
  }
}

export function MarketingAnalyticsBridge() {
  useEffect(() => subscribeMarketingEvents(forwardMarketingEvent), [])
  return null
}
