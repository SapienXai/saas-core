"use client"

import Link from "next/link"
import { Loader2, SlidersHorizontal, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useLanguage } from "@/context/language-context"
import { RestaurantCard } from "@/components/restaurant-card"
import type { PublicRestaurantProfile } from "@/lib/restaurant-profile"
import {
  buildRestaurantDiscoveryHref,
  RESTAURANT_DISCOVERY_PRESETS,
  type RestaurantDiscoveryResult,
} from "@/lib/restaurant-discovery"

const ATMOSPHERE_PRESETS = ["Relaxing", "Serene", "Upscale", "Lively"] as const

type RestaurantGridProps = {
  result: RestaurantDiscoveryResult
  loadError?: boolean
}

function FilterValue({ value, removeLabel, onClear }: { value: string; removeLabel: string; onClear: () => void }) {
  return (
    <button type="button" className="restaurant-discovery-active-filter" aria-label={removeLabel} onClick={onClear}>
      <span>{value}</span>
      <X aria-hidden="true" />
    </button>
  )
}

function buildDiscoveryBatchUrl(query: RestaurantDiscoveryResult["query"], cursor: string) {
  const params = new URLSearchParams()
  if (query.q) params.set("q", query.q)
  if (query.location) params.set("location", query.location)
  if (query.cuisine) params.set("cuisine", query.cuisine)
  if (query.atmosphere) params.set("atmosphere", query.atmosphere)
  params.set("cursor", cursor)
  return `/api/restaurants/discovery?${params.toString()}`
}

export function RestaurantGrid({ result, loadError = false }: RestaurantGridProps) {
  const { getTranslation } = useLanguage()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [restaurants, setRestaurants] = useState(result.restaurants)
  const [total, setTotal] = useState(result.total)
  const [nextCursor, setNextCursor] = useState(result.nextCursor)
  const [hasMore, setHasMore] = useState(result.hasMore)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const closeFilterButtonRef = useRef<HTMLButtonElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const autoLoadLockRef = useRef(false)
  const hasUserScrolledRef = useRef(false)
  const { query } = result
  const hasFilters = Boolean(query.q || query.location || query.cuisine || query.atmosphere)
  const from = restaurants.length > 0 ? (query.page - 1) * query.pageSize + 1 : 0
  const to = Math.min((query.page - 1) * query.pageSize + restaurants.length, total)

  useEffect(() => {
    setRestaurants(result.restaurants)
    setTotal(result.total)
    setNextCursor(result.nextCursor)
    setHasMore(result.hasMore)
    setIsLoadingMore(false)
    setLoadMoreError(false)
    autoLoadLockRef.current = false
    hasUserScrolledRef.current = false
  }, [result])

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || isLoadingMore) return

    setIsLoadingMore(true)
    setLoadMoreError(false)
    try {
      const response = await fetch(buildDiscoveryBatchUrl(query, nextCursor), {
        headers: { Accept: "application/json" },
      })
      if (!response.ok) throw new Error("Could not load the next restaurant batch.")

      const payload = await response.json() as {
        restaurants?: PublicRestaurantProfile[]
        total?: number
        nextCursor?: string | null
        hasMore?: boolean
      }
      const nextRestaurants = Array.isArray(payload.restaurants) ? payload.restaurants : []
      setRestaurants((current) => {
        const known = new Set(current.map((restaurant) => restaurant.restaurantId || restaurant.slug))
        return [...current, ...nextRestaurants.filter((restaurant) => !known.has(restaurant.restaurantId || restaurant.slug))]
      })
      if (typeof payload.total === "number") setTotal(payload.total)
      setNextCursor(payload.nextCursor || null)
      setHasMore(payload.hasMore === true && Boolean(payload.nextCursor))
    } catch (error) {
      console.error("Could not load the next restaurant batch:", error)
      setLoadMoreError(true)
    } finally {
      setIsLoadingMore(false)
    }
  }, [hasMore, isLoadingMore, nextCursor, query])

  const requestMore = useCallback(() => {
    autoLoadLockRef.current = true
    void loadMore()
  }, [loadMore])

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0) return
      hasUserScrolledRef.current = true
      autoLoadLockRef.current = false
    }
    const handleTouchMove = () => {
      hasUserScrolledRef.current = true
      autoLoadLockRef.current = false
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.key === "ArrowDown" || event.key === "PageDown" || event.key === " " || event.key === "End")) return
      hasUserScrolledRef.current = true
      autoLoadLockRef.current = false
    }
    window.addEventListener("wheel", handleWheel, { passive: true })
    window.addEventListener("touchmove", handleTouchMove, { passive: true })
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("wheel", handleWheel)
      window.removeEventListener("touchmove", handleTouchMove)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (!sentinel || !hasMore || !nextCursor || loadMoreError || typeof IntersectionObserver === "undefined") return

    const observer = new IntersectionObserver((entries) => {
      const isIntersecting = entries[0]?.isIntersecting === true
      if (!isIntersecting) return
      if (!hasUserScrolledRef.current) return
      if (autoLoadLockRef.current) return
      autoLoadLockRef.current = true
      void loadMore()
    }, { rootMargin: "240px 0px" })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore, loadMoreError, nextCursor])

  useEffect(() => {
    if (!filtersOpen) return

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false)
    }

    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", handleKeyDown)
    closeFilterButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [filtersOpen])

  return (
    <section className="restaurant-discovery-content marketing-container" aria-label={getTranslation("public.directory.filtersLabel")}>
        <div className="restaurant-discovery-toolbar">
          <div className="restaurant-discovery-result-copy">
            <p className="restaurant-discovery-result-count">
            {getTranslation(total === 1 ? "public.directory.resultCount" : "public.directory.resultsCount", { count: total })}
            </p>
            {total > 0 && (
              <p className="restaurant-discovery-result-range">
                {getTranslation("public.directory.showingResults", { from, to, total })}
              </p>
            )}
          </div>

          <button
            type="button"
            className="restaurant-discovery-mobile-filter-button"
            aria-expanded={filtersOpen}
            aria-controls="restaurant-discovery-filter-sheet"
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {getTranslation("public.directory.mobileFilters")}
          </button>

          <div className="restaurant-discovery-desktop-filters">
            <form action="/restaurants" method="get">
              <input type="hidden" name="q" value={query.q || ""} />
              <input type="hidden" name="location" value={query.location || ""} />
              <label>
                <span>{getTranslation("public.directory.cuisineFilter")}</span>
                <select name="cuisine" defaultValue={query.cuisine || ""}>
                  <option value="">{getTranslation("public.directory.cuisineFilter")}</option>
                  {RESTAURANT_DISCOVERY_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
                </select>
              </label>
              <label>
                <span>{getTranslation("public.directory.atmosphereFilter")}</span>
                <select name="atmosphere" defaultValue={query.atmosphere || ""}>
                  <option value="">{getTranslation("public.directory.allAtmospheres")}</option>
                  {ATMOSPHERE_PRESETS.map((atmosphere) => <option key={atmosphere} value={atmosphere}>{atmosphere}</option>)}
                </select>
              </label>
              <button type="submit">{getTranslation("public.directory.applyFilters")}</button>
            </form>
          </div>
        </div>

        {hasFilters && (
          <div className="restaurant-discovery-active-filters" aria-label={getTranslation("public.directory.activeFilters")}>
            {query.q && <FilterValue value={query.q} removeLabel={getTranslation("public.directory.removeFilter", { filter: query.q })} onClear={() => window.location.assign(buildRestaurantDiscoveryHref(query, { q: undefined, page: 1 }))} />}
            {query.location && <FilterValue value={query.location} removeLabel={getTranslation("public.directory.removeFilter", { filter: query.location })} onClear={() => window.location.assign(buildRestaurantDiscoveryHref(query, { location: undefined, page: 1 }))} />}
            {query.cuisine && <FilterValue value={query.cuisine} removeLabel={getTranslation("public.directory.removeFilter", { filter: query.cuisine })} onClear={() => window.location.assign(buildRestaurantDiscoveryHref(query, { cuisine: undefined, page: 1 }))} />}
            {query.atmosphere && <FilterValue value={query.atmosphere} removeLabel={getTranslation("public.directory.removeFilter", { filter: query.atmosphere })} onClear={() => window.location.assign(buildRestaurantDiscoveryHref(query, { atmosphere: undefined, page: 1 }))} />}
            <Link href="/restaurants" className="restaurant-discovery-clear-filter">{getTranslation("public.directory.clearFilters")}</Link>
          </div>
        )}

        {filtersOpen && (
          <div className="restaurant-discovery-filter-backdrop" role="presentation" onClick={() => setFiltersOpen(false)}>
            <section id="restaurant-discovery-filter-sheet" className="restaurant-discovery-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="restaurant-discovery-filter-title" onClick={(event) => event.stopPropagation()}>
              <div className="restaurant-discovery-filter-sheet-header">
                <h2 id="restaurant-discovery-filter-title">{getTranslation("public.directory.filtersLabel")}</h2>
                <button ref={closeFilterButtonRef} type="button" aria-label={getTranslation("public.directory.closeFilters")} onClick={() => setFiltersOpen(false)}>
                  <X aria-hidden="true" />
                </button>
              </div>
              <form action="/restaurants" method="get" className="restaurant-discovery-filter-form">
                <input type="hidden" name="q" value={query.q || ""} />
                <input type="hidden" name="location" value={query.location || ""} />
                <label>
                  <span>{getTranslation("public.directory.cuisineFilter")}</span>
                  <select name="cuisine" defaultValue={query.cuisine || ""}>
                    <option value="">{getTranslation("public.directory.cuisineFilter")}</option>
                    {RESTAURANT_DISCOVERY_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
                  </select>
                </label>
                <label>
                  <span>{getTranslation("public.directory.atmosphereFilter")}</span>
                  <select name="atmosphere" defaultValue={query.atmosphere || ""}>
                    <option value="">{getTranslation("public.directory.allAtmospheres")}</option>
                    {ATMOSPHERE_PRESETS.map((atmosphere) => <option key={atmosphere} value={atmosphere}>{atmosphere}</option>)}
                  </select>
                </label>
                <button type="submit" className="restaurant-discovery-filter-submit">{getTranslation("public.directory.applyFilters")}</button>
              </form>
            </section>
          </div>
        )}

        {loadError ? (
          <section className="restaurant-discovery-state" role="alert">
            <p className="marketing-eyebrow">{getTranslation("public.directory.eyebrow")}</p>
            <h2>{getTranslation("public.directory.errorTitle")}</h2>
            <p>{getTranslation("public.directory.errorDescription")}</p>
            <button type="button" className="marketing-button marketing-button-primary" onClick={() => window.location.reload()}>
              {getTranslation("public.directory.retry")}
            </button>
          </section>
        ) : restaurants.length > 0 ? (
          <div className="public-restaurant-grid">
            {restaurants.map((restaurant) => <RestaurantCard key={restaurant.restaurantId || restaurant.slug} restaurant={restaurant} />)}
          </div>
        ) : (
          <section className="restaurant-discovery-state" role="status">
            <p className="marketing-eyebrow">{getTranslation("public.directory.eyebrow")}</p>
            <h2>{getTranslation("public.directory.noResultsTitle")}</h2>
            <p>{getTranslation("public.directory.noResultsDescription")}</p>
            <Link href="/restaurants" className="marketing-button marketing-button-primary">
              {getTranslation("public.directory.noResultsReset")}
            </Link>
          </section>
        )}

        {hasMore && nextCursor ? (
          <div ref={loadMoreSentinelRef} className="restaurant-discovery-load-more" aria-live="polite">
            {loadMoreError ? (
              <>
                <p className="restaurant-discovery-load-more-error">{getTranslation("public.directory.loadMoreError")}</p>
                <button type="button" className="restaurant-discovery-load-more-button" onClick={requestMore} disabled={isLoadingMore}>
                  {getTranslation("public.directory.retry")}
                </button>
              </>
            ) : isLoadingMore ? (
              <p className="restaurant-discovery-load-more-status"><Loader2 className="animate-spin" aria-hidden="true" />{getTranslation("public.directory.loadingMore")}</p>
            ) : (
              <button type="button" className="restaurant-discovery-load-more-button" onClick={requestMore}>
                {getTranslation("public.directory.loadMore")}
              </button>
            )}
          </div>
        ) : result.totalPages > 1 && (
          <nav className="restaurant-discovery-pagination" aria-label={getTranslation("common.pagination")}>
            {query.page > 1 ? (
              <Link href={buildRestaurantDiscoveryHref(query, { page: query.page - 1 })} aria-label={getTranslation("public.directory.previousPage")}>
                ← {getTranslation("common.previous")}
              </Link>
            ) : <span aria-disabled="true">← {getTranslation("common.previous")}</span>}
            <strong>{query.page} / {result.totalPages}</strong>
            {query.page < result.totalPages ? (
              <Link href={buildRestaurantDiscoveryHref(query, { page: query.page + 1 })} aria-label={getTranslation("public.directory.nextPage")}>
                {getTranslation("common.next")} →
              </Link>
            ) : <span aria-disabled="true">{getTranslation("common.next")} →</span>}
          </nav>
        )}
    </section>
  )
}
