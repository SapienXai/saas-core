"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { TransitionLoader } from "@/components/ui/transition-loader"

const NAVIGATION_START_EVENT = "saas-core:navigation-start"

export function startNavigationFeedback() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NAVIGATION_START_EVENT))
  }
}

function shouldTrackLink(event: MouseEvent, anchor: HTMLAnchorElement) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  if (anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.getAttribute("aria-disabled") === "true") return false

  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin || url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return false

  const currentUrl = `${window.location.pathname}${window.location.search}`
  return `${url.pathname}${url.search}` !== currentUrl
}

export function NavigationFeedback() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isNavigating, setIsNavigating] = useState(false)
  const routeKey = `${pathname}?${searchParams.toString()}`

  useEffect(() => {
    setIsNavigating(false)
  }, [routeKey])

  useEffect(() => {
    let timeoutId: number | undefined
    const begin = () => {
      setIsNavigating(true)
      if (timeoutId) window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => setIsNavigating(false), 12000)
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
      if (target && shouldTrackLink(event, target)) begin()
    }

    window.addEventListener(NAVIGATION_START_EVENT, begin)
    document.addEventListener("click", handleClick, true)
    return () => {
      window.removeEventListener(NAVIGATION_START_EVENT, begin)
      document.removeEventListener("click", handleClick, true)
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [])

  if (!isNavigating) return null

  return (
    <div className="route-loading-indicator"><TransitionLoader label="Loading page" /></div>
  )
}
