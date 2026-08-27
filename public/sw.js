const RESERVEVIA_SW_VERSION = "reservevia-manage-v3"
const RESERVEVIA_STATIC_CACHE = `${RESERVEVIA_SW_VERSION}:static`
const RESERVEVIA_CACHE_PREFIX = "reservevia-manage-"

function isSameOrigin(url) {
  return url.origin === self.location.origin
}

function isSafeStaticAsset(url) {
  if (!isSameOrigin(url)) return false
  return url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/favicon.png"
}

async function isManagementAssetRequest(request, clientId) {
  let pageUrl = null
  if (clientId) {
    const client = await self.clients.get(clientId).catch(() => null)
    pageUrl = client?.url || null
  }
  if (!pageUrl) pageUrl = request.referrer || null
  if (!pageUrl) return false
  try {
    const page = new URL(pageUrl)
    return page.origin === self.location.origin && page.pathname.startsWith("/manage")
  } catch {
    return false
  }
}

function isManagementNavigation(request, url) {
  return request.mode === "navigate" && isSameOrigin(url) && url.pathname.startsWith("/manage")
}

function offlineResponse() {
  return new Response(
    "<!doctype html><html><head><title>Reservevia offline</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body style=\"font-family:system-ui,sans-serif;padding:24px\"><main><h1>You're offline</h1><p>Reconnect to continue managing reservations.</p><button onclick=\"location.reload()\">Retry</button></main></body></html>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(RESERVEVIA_STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok && response.type === "basic") await cache.put(request, response.clone())
    return response
  } catch {
    return new Response(null, { status: 504, statusText: "Offline" })
  }
}

function safeManagementUrl(value) {
  try {
    const candidate = new URL(typeof value === "string" ? value : "/manage", self.location.origin)
    if (candidate.origin !== self.location.origin || !candidate.pathname.startsWith("/manage")) {
      return new URL("/manage", self.location.origin).href
    }
    return candidate.href
  } catch {
    return new URL("/manage", self.location.origin).href
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.resolve())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => (
            (cacheName.startsWith(RESERVEVIA_CACHE_PREFIX) && cacheName !== RESERVEVIA_STATIC_CACHE) ||
            cacheName.startsWith("manage-offline-")
          ))
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clientList) => {
        for (const client of clientList) client.postMessage({ type: "RESERVEVIA_SW_ACTIVATED", version: RESERVEVIA_SW_VERSION })
      }),
  )
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_MANAGE_OFFLINE_CACHE") {
    event.waitUntil(caches.keys().then((cacheNames) => Promise.all(cacheNames.filter((name) => name.startsWith(RESERVEVIA_CACHE_PREFIX) || name.startsWith("manage-offline-")).map((name) => caches.delete(name)))))
  }
  if (event.data?.type === "CACHE_STATIC_URLS" && Array.isArray(event.data.urls)) {
    const safeUrls = event.data.urls.filter((value) => {
      try { return isSafeStaticAsset(new URL(value, self.location.origin)) } catch { return false }
    })
    event.waitUntil(
      caches.open(RESERVEVIA_STATIC_CACHE).then((cache) => Promise.all(safeUrls.map(async (value) => {
        const response = await fetch(value)
        if (response.ok && response.type === "basic") await cache.put(value, response)
      }))).catch(() => undefined),
    )
  }
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting()
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (!isSameOrigin(url)) return

  if (isManagementNavigation(request, url)) {
    event.respondWith(fetch(request).catch(() => offlineResponse()))
    return
  }

  if (isSafeStaticAsset(url)) {
    event.respondWith((async () => {
      if (await isManagementAssetRequest(request, event.clientId)) return cacheFirstStatic(request)
      return fetch(request)
    })())
  }
})

self.addEventListener("push", (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }

  const title = data.title || "Reservevia"
  const icon = typeof data.icon === "string" && data.icon ? data.icon : "/icon-512.png"
  const options = {
    body: data.body || "Reservation activity received.",
    icon,
    badge: typeof data.badge === "string" && data.badge ? data.badge : icon,
    data: { url: safeManagementUrl(data.url), reservationId: data.reservationId, event: data.event },
    tag: data.reservationId ? `reservation-${data.reservationId}-${data.event || "activity"}` : undefined,
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const targetUrl = safeManagementUrl(event.notification.data?.url)
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        let sameOrigin = false
        try { sameOrigin = new URL(client.url).origin === self.location.origin } catch {}
        if ("focus" in client && sameOrigin) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    }),
  )
})
