"use client"

import { LocateFixed, Loader2, Navigation, Minus, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { useLanguage } from "@/context/language-context"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"
import { getPublicMapCoordinates } from "@/lib/public-map"
import type { PublicBrandLocation } from "@/lib/services/public/brand-service"

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"
const MAP_WORKER_URL = "/vendor/maplibre-gl/maplibre-gl-worker.mjs"
const MIN_ZOOM = 3
const MAX_ZOOM = 19
const LOCATION_ZOOM = 15
const MAP_FIT_PADDING = { top: 76, right: 72, bottom: 82, left: 72 }

type UserLocation = {
  latitude: number
  longitude: number
  accuracy: number
}

type LocationStatus = "idle" | "loading" | "granted" | "denied" | "unavailable"
type MappableLocation = PublicBrandLocation & { latitude: number; longitude: number }
type MapLibreModule = typeof import("maplibre-gl")
type MapLibreMap = import("maplibre-gl").Map
type MapLibreMarker = import("maplibre-gl").Marker
type MapLibrePopup = import("maplibre-gl").Popup

type Props = {
  locations: PublicBrandLocation[]
  logoUrl?: string | null
  brandName?: string
  focusLocationSlug?: string | null
  highlightLocationSlug?: string | null
  onLocationSelect?: (locationSlug: string) => void
}

function isValidCoordinate(latitude: number | null, longitude: number | null): latitude is number {
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
}

function distanceInKilometers(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
  const earthRadius = 6371
  const latitudeDelta = ((right.latitude - left.latitude) * Math.PI) / 180
  const longitudeDelta = ((right.longitude - left.longitude) * Math.PI) / 180
  const leftLatitude = (left.latitude * Math.PI) / 180
  const rightLatitude = (right.latitude * Math.PI) / 180
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.sin(longitudeDelta / 2) ** 2 * Math.cos(leftLatitude) * Math.cos(rightLatitude)
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function formatDistance(distance: number, locale: string) {
  if (distance < 1) return `${Math.max(1, Math.round(distance * 1000))} m`
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(distance)} km`
}

function getMapLink(location: PublicBrandLocation) {
  if (location.locationUrl?.trim()) return location.locationUrl.trim()
  if (isValidCoordinate(location.latitude, location.longitude)) {
    return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
  }
  const query = location.address.formatted || location.location || location.name
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null
}

function getLocationLabel(location: PublicBrandLocation) {
  return location.address.formatted || location.location || location.address.locality || location.address.region || ""
}

function getBounds(locations: MappableLocation[]) {
  if (locations.length === 0) return null
  const longitudes = locations.map((location) => location.longitude)
  const latitudes = locations.map((location) => location.latitude)
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ] as [[number, number], [number, number]]
}

function getInitialCenter(locations: MappableLocation[]) {
  const first = locations[0]
  return first ? [first.longitude, first.latitude] as [number, number] : [0, 0] as [number, number]
}

function fitLocations(map: MapLibreMap, locations: MappableLocation[], duration: number) {
  if (locations.length === 0) return
  if (locations.length === 1) {
    map.flyTo({ center: [locations[0].longitude, locations[0].latitude], zoom: 14, duration, essential: true })
    return
  }

  const bounds = getBounds(locations)
  if (!bounds) return
  const samePoint = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]
  if (samePoint) {
    map.flyTo({ center: bounds[0], zoom: 14, duration, essential: true })
    return
  }
  map.fitBounds(bounds, { padding: MAP_FIT_PADDING, maxZoom: 14, duration, essential: true })
}

function createMarkerElement(locationName: string) {
  const root = document.createElement("div")
  root.className = "public-brand-map-location"

  const distance = document.createElement("span")
  distance.className = "public-brand-map-distance"
  distance.hidden = true

  const button = document.createElement("button")
  button.type = "button"
  button.className = "public-brand-map-pin"
  button.setAttribute("aria-label", locationName)
  button.setAttribute("aria-expanded", "false")
  button.title = locationName

  const pulse = document.createElement("span")
  pulse.className = "public-brand-map-pin-pulse"
  pulse.setAttribute("aria-hidden", "true")
  const pulseCore = document.createElement("span")
  pulse.append(pulseCore)
  button.append(pulse)
  root.append(distance, button)

  return { root, distance, button }
}

function createUserMarkerElement(label: string) {
  const root = document.createElement("div")
  root.className = "public-brand-map-user-location"
  root.setAttribute("aria-label", label)
  root.setAttribute("role", "img")
  const core = document.createElement("span")
  core.setAttribute("aria-hidden", "true")
  root.append(core)
  return root
}

function createPopupContent(
  location: MappableLocation,
  distance: string | null,
  distanceLabel: string,
  openInMapsLabel: string,
  mapLink: string | null,
) {
  const content = document.createElement("div")
  content.className = "public-brand-map-popup-content"
  content.setAttribute("role", "dialog")
  content.setAttribute("aria-label", location.name)

  const title = document.createElement("strong")
  title.className = "public-brand-map-popup-title"
  title.textContent = location.name
  content.append(title)

  const place = getLocationLabel(location)
  if (place) {
    const placeElement = document.createElement("span")
    placeElement.className = "public-brand-map-popup-place"
    placeElement.textContent = place
    content.append(placeElement)
  }

  if (distance) {
    const distanceElement = document.createElement("span")
    distanceElement.className = "public-brand-map-popup-distance"
    distanceElement.textContent = distanceLabel.replace("{distance}", distance)
    content.append(distanceElement)
  }

  if (mapLink) {
    const link = document.createElement("a")
    link.href = mapLink
    link.target = "_blank"
    link.rel = "noreferrer"
    link.textContent = openInMapsLabel
    content.append(link)
  }

  return content
}

export function PublicBrandMap({
  locations,
  logoUrl,
  brandName,
  focusLocationSlug = "all",
  highlightLocationSlug = null,
  onLocationSelect,
}: Props) {
  const { currentLang, getTranslation } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<MapLibreMap | null>(null)
  const maplibreRef = useRef<MapLibreModule | null>(null)
  const markersRef = useRef(new Map<string, { marker: MapLibreMarker; root: HTMLDivElement; distance: HTMLSpanElement; button: HTMLButtonElement }>())
  const userMarkerRef = useRef<MapLibreMarker | null>(null)
  const popupRef = useRef<MapLibrePopup | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle")
  const [isDragging, setIsDragging] = useState(false)

  const mappableLocations = useMemo<MappableLocation[]>(
    () => locations.flatMap((location) => {
      const coordinates = getPublicMapCoordinates(location)
      return coordinates ? [{ ...location, ...coordinates }] : []
    }),
    [locations],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let map: MapLibreMap | null = null
    let resizeObserver: ResizeObserver | null = null
    const markerEntries = markersRef.current

    const initialize = async () => {
      try {
        const maplibre = await import("maplibre-gl")
        if (cancelled) return
        maplibreRef.current = maplibre
        // Next's dev/runtime module URL can resolve to the page route. Point
        // MapLibre at the package worker asset explicitly so vector tiles are
        // parsed in a real module worker in both dev and production builds.
        maplibre.setWorkerUrl(MAP_WORKER_URL)
        map = new maplibre.Map({
          container,
          style: MAP_STYLE_URL,
          center: getInitialCenter(mappableLocations),
          zoom: 3,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          cooperativeGestures: false,
          scrollZoom: true,
        })
        mapInstanceRef.current = map
        map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right")
        map.on("error", () => setMapError(true))
        map.on("click", () => setSelectedSlug(null))
        map.on("dragstart", () => setIsDragging(true))
        map.on("dragend", () => setIsDragging(false))
        map.on("load", () => {
          if (cancelled || !map) return
          setMapError(false)
          setMapReady(true)
          map.resize()
          fitLocations(map, mappableLocations, 0)
        })

        resizeObserver = new ResizeObserver(() => map?.resize())
        resizeObserver.observe(container)
      } catch {
        if (!cancelled) setMapError(true)
      }
    }

    void initialize()
    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      popupRef.current?.remove()
      popupRef.current = null
      markerEntries.forEach(({ marker }) => marker.remove())
      markerEntries.clear()
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      map?.remove()
      mapInstanceRef.current = null
      maplibreRef.current = null
      setMapReady(false)
      setIsDragging(false)
    }
  }, [mappableLocations])

  useEffect(() => {
    const map = mapInstanceRef.current
    const maplibre = maplibreRef.current
    if (!map || !maplibre || !mapReady) return

    const nextSlugs = new Set(mappableLocations.map((location) => location.slug))
    for (const [slug, entry] of markersRef.current) {
      if (!nextSlugs.has(slug)) {
        entry.marker.remove()
        markersRef.current.delete(slug)
      }
    }

    for (const location of mappableLocations) {
      let entry = markersRef.current.get(location.slug)
      if (!entry) {
        const elements = createMarkerElement(location.name)
        elements.button.addEventListener("click", (event) => {
          event.stopPropagation()
          setSelectedSlug((current) => current === location.slug ? null : location.slug)
          onLocationSelect?.(location.slug)
        })
        const marker = new maplibre.Marker({ element: elements.root, anchor: "center" })
          .setLngLat([location.longitude, location.latitude])
          .addTo(map)
        entry = { marker, ...elements }
        markersRef.current.set(location.slug, entry)
      } else {
        entry.marker.setLngLat([location.longitude, location.latitude])
      }

      const selected = selectedSlug === location.slug
      const active = selected
        || focusLocationSlug === location.slug
        || (focusLocationSlug === "all" && highlightLocationSlug === location.slug)
      entry.root.classList.toggle("is-active", active)
      entry.root.classList.toggle("is-selected", selected)
      entry.button.setAttribute("aria-expanded", String(selected))

      if (userLocation) {
        const distance = formatDistance(distanceInKilometers(userLocation, location), currentLang)
        entry.distance.hidden = false
        entry.distance.textContent = distance
        entry.distance.setAttribute("aria-label", `${location.name}: ${getTranslation("public.brand.distanceAway", { distance })}`)
      } else {
        entry.distance.hidden = true
        entry.distance.textContent = ""
        entry.distance.removeAttribute("aria-label")
      }
    }

    if (userLocation) {
      const markerElement = userMarkerRef.current?.getElement() || createUserMarkerElement(getTranslation("public.brand.yourLocation"))
      if (!userMarkerRef.current) {
        userMarkerRef.current = new maplibre.Marker({ element: markerElement, anchor: "center" })
          .setLngLat([userLocation.longitude, userLocation.latitude])
          .addTo(map)
      }
      userMarkerRef.current.setLngLat([userLocation.longitude, userLocation.latitude])
    } else {
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
    }
  }, [currentLang, focusLocationSlug, getTranslation, highlightLocationSlug, mapReady, mappableLocations, onLocationSelect, selectedSlug, userLocation])

  useEffect(() => {
    const map = mapInstanceRef.current
    const maplibre = maplibreRef.current
    if (!map || !maplibre || !mapReady) return

    popupRef.current?.remove()
    popupRef.current = null
    const location = mappableLocations.find((candidate) => candidate.slug === selectedSlug)
    if (!location) return

    const distance = userLocation ? formatDistance(distanceInKilometers(userLocation, location), currentLang) : null
    const popup = new maplibre.Popup({
      className: "public-brand-map-popup",
      closeButton: true,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: true,
      offset: 22,
      maxWidth: "240px",
    })
      .setLngLat([location.longitude, location.latitude])
      .setDOMContent(createPopupContent(
        location,
        distance,
        getTranslation("public.brand.distanceAway"),
        getTranslation("public.brand.openInMaps"),
        getMapLink(location),
      ))
      .addTo(map)

    const handleClose = () => setSelectedSlug((current) => current === location.slug ? null : current)
    popup.on("close", handleClose)
    popupRef.current = popup

    return () => {
      popup.off("close", handleClose)
      popup.remove()
      if (popupRef.current === popup) popupRef.current = null
    }
  }, [currentLang, getTranslation, mapReady, mappableLocations, selectedSlug, userLocation])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady) return

    if (!focusLocationSlug || focusLocationSlug === "all") {
      setSelectedSlug(null)
      fitLocations(map, mappableLocations, 420)
      return
    }

    const focusedLocation = mappableLocations.find((location) => location.slug === focusLocationSlug)
    if (!focusedLocation) {
      setSelectedSlug(null)
      return
    }

    setSelectedSlug(focusedLocation.slug)
    map.flyTo({
      center: [focusedLocation.longitude, focusedLocation.latitude],
      zoom: LOCATION_ZOOM,
      duration: 520,
      essential: true,
    })
  }, [focusLocationSlug, mapReady, mappableLocations])

  const requestUserLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus("unavailable")
      return
    }
    setLocationStatus("loading")
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nextLocation = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }
        setUserLocation(nextLocation)
        setLocationStatus("granted")
        mapInstanceRef.current?.flyTo({ center: [nextLocation.longitude, nextLocation.latitude], zoom: LOCATION_ZOOM, duration: 650, essential: true })
      },
      () => setLocationStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  const zoomMap = (delta: number) => {
    const map = mapInstanceRef.current
    if (!map) return
    setSelectedSlug(null)
    map.zoomTo(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, map.getZoom() + delta)), { duration: 220, essential: true })
  }

  const locationMessage = locationStatus === "denied"
    ? getTranslation("public.brand.locationAccessDenied")
    : locationStatus === "unavailable"
      ? getTranslation("public.brand.locationNotSupported")
      : null
  const locationButtonLabel = locationStatus === "loading"
    ? getTranslation("public.brand.requestingLocation")
    : locationStatus === "granted"
      ? getTranslation("public.brand.yourLocation")
      : getTranslation("public.brand.useMyLocation")
  const safeLogoUrl = getSafeRestaurantAssetUrl(logoUrl)
  const brandInitial = brandName?.trim().slice(0, 1).toUpperCase() || "R"

  return (
    <>
      <div className="public-brand-map-hero-bar">
        <div className="public-brand-map-brand" aria-label={brandName || "Reservevia"}>
          {safeLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={safeLogoUrl} alt="" />
          ) : <span aria-hidden="true">{brandInitial}</span>}
        </div>
        <div className="public-brand-map-hero-actions">
          {locationMessage ? <span className="public-brand-map-location-note" role="status">{locationMessage}</span> : null}
          <div className="public-brand-map-control-stack">
            <button type="button" className="public-brand-map-control" onClick={requestUserLocation} disabled={locationStatus === "loading"} aria-label={locationButtonLabel} title={locationButtonLabel}>
              {locationStatus === "loading" ? <Loader2 className="public-brand-spin" aria-hidden="true" /> : locationStatus === "granted" ? <Navigation aria-hidden="true" /> : <LocateFixed aria-hidden="true" />}
            </button>
            <div className="public-brand-map-zoom-controls" role="group" aria-label={getTranslation("public.brand.mapZoomControls")}>
              <button type="button" onClick={() => zoomMap(1)} aria-label={getTranslation("public.brand.zoomIn")} title={getTranslation("public.brand.zoomIn")}><Plus aria-hidden="true" /></button>
              <button type="button" onClick={() => zoomMap(-1)} aria-label={getTranslation("public.brand.zoomOut")} title={getTranslation("public.brand.zoomOut")}><Minus aria-hidden="true" /></button>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`public-brand-map public-brand-map--real${isDragging ? " is-dragging" : ""}`}
        data-map-status={mapError ? "error" : mapReady ? "ready" : "loading"}
        aria-busy={!mapReady && !mapError}
        role="group"
        aria-label={getTranslation("public.brand.mapLabel")}
      >
        {!mapReady && !mapError ? <div className="public-brand-map-state" role="status" aria-live="polite"><div className="public-brand-map-loading-card"><span className="public-brand-map-loading-spinner"><Loader2 className="public-brand-spin" aria-hidden="true" /></span><span>{getTranslation("public.brand.mapLabel")}</span></div></div> : null}
        {mapError ? <div className="public-brand-map-state is-error" role="status">Map temporarily unavailable</div> : null}
      </div>
    </>
  )
}
