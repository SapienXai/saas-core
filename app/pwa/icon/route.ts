import { NextResponse } from "next/server"
import sharp from "sharp"
import { classifyHostname } from "@/lib/domains/hostname"
import { getPublicPwaBranding, PWA_FALLBACK_ICON, storagePathFromPublicUrl } from "@/lib/pwa"
import { createServiceRoleClient } from "@/lib/supabase"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

const ICON_SIZES = new Set([180, 192, 512])

function requestHostname(request: Request) {
  return request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || ""
}

function fallbackResponse(request: Request) {
  return NextResponse.redirect(new URL(PWA_FALLBACK_ICON, request.url))
}

function imageHeaders(contentLength: number) {
  const headers = new Headers({
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=300, s-maxage=300",
    "X-Content-Type-Options": "nosniff",
  })
  headers.set("Content-Length", String(contentLength))
  return headers
}

function requestedIconSize(searchParams: URLSearchParams) {
  const requested = Number(searchParams.get("size"))
  return ICON_SIZES.has(requested) ? requested : 512
}

function safeBackgroundColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"
}

async function renderInstallIcon(input: ArrayBuffer, size: number, backgroundColor: string) {
  const contentSize = Math.round(size * 0.8)
  const horizontalSpace = size - contentSize
  const verticalSpace = size - contentSize
  const left = Math.floor(horizontalSpace / 2)
  const top = Math.floor(verticalSpace / 2)

  return sharp(Buffer.from(input), { animated: false, failOn: "none" })
    .rotate()
    .resize(contentSize, contentSize, {
      fit: "contain",
      background: backgroundColor,
    })
    .flatten({ background: backgroundColor })
    .extend({
      left,
      right: horizontalSpace - left,
      top,
      bottom: verticalSpace - top,
      background: backgroundColor,
    })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export async function GET(request: Request) {
  const classification = classifyHostname(requestHostname(request))
  if (!["PLATFORM_APP", "LOCAL_DEVELOPMENT", "VERCEL_PREVIEW"].includes(classification.kind)) {
    return new NextResponse("Not Found", { status: 404 })
  }

  const searchParams = new URL(request.url).searchParams
  const size = requestedIconSize(searchParams)
  const workspaceId = searchParams.get("workspace")?.trim()
  const restaurantId = searchParams.get("restaurant")?.trim() || null
  if (!workspaceId) return fallbackResponse(request)

  const branding = await getPublicPwaBranding(workspaceId, restaurantId)
  if (!branding || branding.iconUrl === PWA_FALLBACK_ICON) return fallbackResponse(request)

  const storagePath = storagePathFromPublicUrl(branding.iconUrl)
  let sourceBytes: ArrayBuffer
  if (storagePath) {
    const { data, error } = await createServiceRoleClient()
      .storage
      .from("restaurant-assets")
      .download(storagePath)
    if (error || !data) return fallbackResponse(request)
    sourceBytes = await data.arrayBuffer()
  } else {
    try {
      const sourceUrl = new URL(branding.iconUrl)
      if (sourceUrl.protocol !== "https:") return fallbackResponse(request)
      const response = await fetch(sourceUrl, { cache: "no-store", redirect: "follow" })
      if (!response.ok) return fallbackResponse(request)
      sourceBytes = await response.arrayBuffer()
    } catch {
      return fallbackResponse(request)
    }
  }

  try {
    const icon = await renderInstallIcon(sourceBytes, size, safeBackgroundColor(branding.backgroundColor))
    return new NextResponse(new Uint8Array(icon), { headers: imageHeaders(icon.byteLength) })
  } catch {
    return fallbackResponse(request)
  }
}
