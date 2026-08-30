import { NextResponse } from "next/server"
import { getRequestHostname, isDevelopmentTunnelHostname, isLocalDevelopmentHostname, isLoopbackDevelopmentHostname } from "@/lib/domains/hostname"

const DEFAULT_MAILPIT_ORIGIN = "http://127.0.0.1:55624"
const MAILPIT_PREFIX = "/api/dev/mailpit"
const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "if-modified-since", "if-none-match", "range"]
const FORWARDED_RESPONSE_HEADERS = ["cache-control", "content-type", "etag", "last-modified"]

type MailpitRouteContext = { params: Promise<{ path?: string[] }> }

function getMailpitOrigin() {
  const configured = process.env.SAAS_CORE_MAIL_URL?.trim() || process.env.NEXT_PUBLIC_DEV_MAILPIT_URL?.trim()
  if (!configured) return DEFAULT_MAILPIT_ORIGIN
  try {
    const url = new URL(configured)
    if (!isLoopbackDevelopmentHostname(url.hostname)) return null
    url.hostname = "127.0.0.1"
    return url.origin
  } catch {
    return null
  }
}

function rewriteMailpitHtml(html: string) {
  return html
    .replaceAll('data-webroot="/"', `data-webroot="${MAILPIT_PREFIX}/"`)
    .replaceAll('href="/dist/', `href="${MAILPIT_PREFIX}/dist/`)
    .replaceAll('src="/dist/', `src="${MAILPIT_PREFIX}/dist/`)
    .replaceAll('href="/favicon.svg"', `href="${MAILPIT_PREFIX}/favicon.svg"`)
    // Next route handlers proxy HTTP, not WebSocket upgrades. Mailpit's live
    // refresh is optional; disable only that client connection so the inbox
    // remains usable without a misleading browser console failure.
    .replace("</head>", `<script>window.WebSocket=class{constructor(){this.readyState=3;queueMicrotask(()=>this.onclose?.({code:1000}))}close(){}};</script></head>`)
}

function getUpstreamUrl(request: Request, origin: string, path?: string[]) {
  const encodedPath = (path || []).map((segment) => encodeURIComponent(segment)).join("/")
  const upstream = new URL(encodedPath ? `/${encodedPath}` : "/", origin)
  upstream.search = new URL(request.url).search
  return upstream
}

async function proxyMailpit(request: Request, context: MailpitRouteContext) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const requestHostname = getRequestHostname(request)
  if (!requestHostname || (!isLocalDevelopmentHostname(requestHostname) && !isDevelopmentTunnelHostname(requestHostname))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const mailpitOrigin = getMailpitOrigin()
    if (!mailpitOrigin) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { path } = await context.params
    const headers = new Headers()
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
      cache: "no-store",
    }
    if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer()

    const upstreamResponse = await fetch(getUpstreamUrl(request, mailpitOrigin, path), init)
    const responseHeaders = new Headers()
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstreamResponse.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }

    const location = upstreamResponse.headers.get("location")
    if (location?.startsWith("/")) responseHeaders.set("location", `${MAILPIT_PREFIX}${location}`)

    const contentType = upstreamResponse.headers.get("content-type") || ""
    const body = contentType.includes("text/html")
      ? rewriteMailpitHtml(await upstreamResponse.text())
      : upstreamResponse.body

    return new Response(body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    })
  } catch {
    return NextResponse.json(
      { error: "The development inbox is unavailable. Start the local Supabase services and try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
}

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export function GET(request: Request, context: MailpitRouteContext) { return proxyMailpit(request, context) }
export function HEAD(request: Request, context: MailpitRouteContext) { return proxyMailpit(request, context) }
export function POST(request: Request, context: MailpitRouteContext) { return proxyMailpit(request, context) }
export function PUT(request: Request, context: MailpitRouteContext) { return proxyMailpit(request, context) }
export function PATCH(request: Request, context: MailpitRouteContext) { return proxyMailpit(request, context) }
export function DELETE(request: Request, context: MailpitRouteContext) { return proxyMailpit(request, context) }

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { Allow: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" },
  })
}
