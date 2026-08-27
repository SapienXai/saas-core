import "server-only"

import { lookup } from "node:dns/promises"
import { randomUUID } from "node:crypto"
import { isIP } from "node:net"

import { createServiceRoleClient } from "@/lib/supabase"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"
import { importRestaurantFromWebsite, type WebsiteImportCandidate, type WebsiteImportResult } from "@/lib/website-import"
import { enrichRestaurantWebsiteProfile, type RestaurantWebsiteEnrichmentResult } from "@/lib/restaurant-website-enrichment"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_FETCH_TIMEOUT_MS = 10_000
const MAX_IMAGE_REDIRECTS = 3
const MAX_CANDIDATES_PER_KIND = 6

type AssetKind = "logo" | "primary"
type AssetStatus = "imported" | "already_present" | "not_found" | "failed"

export type WebsiteAssetSyncResult = {
  success: boolean
  sourceUrl: string
  logo: { status: AssetStatus; url: string | null; message?: string }
  primary: { status: AssetStatus; url: string | null; message?: string }
  message?: string
}

export type WebsiteImageFile = {
  bytes: Uint8Array
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif"
  extension: "jpg" | "png" | "webp" | "gif" | "avif"
}

function blockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true
  if (["::1", "0.0.0.0", "127.0.0.1"].includes(host)) return true
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true
  const private172 = /^172\.(\d{1,3})\./.exec(host)?.[1]
  if (private172 && Number(private172) >= 16 && Number(private172) <= 31) return true
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true
  if (isIP(host) && blockedAddress(host)) return true
  return false
}

function blockedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized.includes(":")) {
    if (["::", "::1"].includes(normalized) || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("2001:db8:")) return true
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
    return mappedIpv4 ? blockedAddress(mappedIpv4) : false
  }
  const parts = normalized.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 0 && parts[2] === 0 || parts[0] === 192 && parts[1] === 168 || parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19 || parts[0] === 198 && parts[1] === 51 && parts[2] === 100 || parts[0] === 203 && parts[1] === 0 && parts[2] === 113 || parts[0] >= 224
}

function sameOrSubdomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`)
}

async function assertSafePublicUrl(value: string, expectedDomain?: string | null) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("The official website returned an invalid URL.")
  }
  if (!/^https?:$/i.test(url.protocol) || url.username || url.password || blockedHostname(url.hostname)) {
    throw new Error("The official website URL is private or unsupported.")
  }
  if (expectedDomain && !sameOrSubdomain(url.hostname.toLowerCase(), expectedDomain.toLowerCase())) {
    throw new Error("The official website redirected outside its verified domain.")
  }
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address))) throw new Error("The website host resolves to a private address.")
  } catch (error) {
    if (error instanceof Error && error.message.includes("private")) throw error
    throw new Error("The official website host could not be verified.")
  }
  return url
}

export async function assertSafeOfficialWebsiteUrl(value: string, expectedDomain?: string | null) {
  return assertSafePublicUrl(value, expectedDomain)
}

async function assertSafeImageUrl(value: string, expectedDomain?: string | null) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("The website returned an invalid image URL.")
  }
  if (!/^https?:$/i.test(url.protocol) || url.username || url.password || blockedHostname(url.hostname)) {
    throw new Error("The website returned a private or unsupported image URL.")
  }
  if (expectedDomain && !sameOrSubdomain(url.hostname.toLowerCase(), expectedDomain.toLowerCase())) {
    throw new Error("The image redirected outside its verified official domain.")
  }

  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address))) {
      throw new Error("The image host resolves to a private address.")
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("private")) throw error
    throw new Error("The image host could not be verified.")
  }
  return url
}

function imageFromMagicBytes(bytes: Uint8Array): WebsiteImageFile | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, contentType: "image/jpeg", extension: "jpg" }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { bytes, contentType: "image/png", extension: "png" }
  if (bytes.length >= 6 && /^(GIF87a|GIF89a)$/.test(String.fromCharCode(...bytes.slice(0, 6)))) return { bytes, contentType: "image/gif", extension: "gif" }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { bytes, contentType: "image/webp", extension: "webp" }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase()
    if (brand === "avif" || brand === "avis") return { bytes, contentType: "image/avif", extension: "avif" }
  }
  return null
}

async function readResponseBytes(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || 0)
  if (contentLength > MAX_IMAGE_BYTES) throw new Error("The image is larger than 5 MB.")
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("The image is larger than 5 MB.")
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw new Error("The image is larger than 5 MB.")
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function fetchVerifiedWebsiteImage(inputUrl: string, options?: { expectedDomain?: string | null }): Promise<WebsiteImageFile> {
  let currentUrl = inputUrl
  for (let redirect = 0; redirect <= MAX_IMAGE_REDIRECTS; redirect += 1) {
    const url = await assertSafeImageUrl(currentUrl, options?.expectedDomain)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
          "user-agent": "Reservevia Website Asset Importer/1.0 (+https://reservevia.app)",
        },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        if (!location) throw new Error("The image returned an invalid redirect.")
        currentUrl = new URL(location, url).toString()
        continue
      }
      if (!response.ok) throw new Error(`The image returned ${response.status}.`)
      const bytes = await readResponseBytes(response)
      const image = imageFromMagicBytes(bytes)
      if (!image) throw new Error("The website image is not a supported raster image.")
      return image
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("The image took too long to download.")
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error("Too many image redirects.")
}

export async function uploadVerifiedWebsiteImage(input: {
  service: ReturnType<typeof createServiceRoleClient>
  bucket: string
  path: string
  image: WebsiteImageFile
  cacheControl?: string
  upsert?: boolean
}) {
  const { service, bucket, path, image } = input
  const storage = service.storage.from(bucket)
  const { error } = await storage.upload(path, image.bytes, { contentType: image.contentType, cacheControl: input.cacheControl || "31536000", upsert: input.upsert === true })
  if (error) throw new Error(error.message)
  return path
}

async function uploadImage(service: ReturnType<typeof createServiceRoleClient>, workspaceId: string, restaurantId: string, kind: AssetKind, image: WebsiteImageFile) {
  const path = `${workspaceId}/${restaurantId}/${kind}/${randomUUID()}.${image.extension}`
  await uploadVerifiedWebsiteImage({ service, bucket: "restaurant-assets", path, image })
  const storage = service.storage.from("restaurant-assets")
  const publicUrl = storage.getPublicUrl(path).data.publicUrl
  if (!publicUrl) {
    await storage.remove([path])
    throw new Error("The uploaded image URL could not be created.")
  }
  return { path, publicUrl }
}

async function tryCandidates(service: ReturnType<typeof createServiceRoleClient>, workspaceId: string, restaurantId: string, kind: AssetKind, candidates: Array<{ url: string }>) {
  const errors: string[] = []
  for (const candidate of candidates.slice(0, MAX_CANDIDATES_PER_KIND)) {
    try {
      const image = await fetchVerifiedWebsiteImage(candidate.url)
      return { upload: await uploadImage(service, workspaceId, restaurantId, kind, image), error: null }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "The image could not be imported.")
    }
  }
  return { upload: null, error: errors[0] || "No usable image candidate was found." }
}

export async function syncRestaurantWebsiteAssets(input: { restaurantId: string; workspaceId: string; officialWebsiteUrl: string; overwrite?: boolean; preferredLogoUrl?: string | null; preferredPrimaryUrl?: string | null; discovered?: WebsiteImportResult }): Promise<WebsiteAssetSyncResult> {
  const service = createServiceRoleClient()
  const { data: restaurant, error: restaurantError } = await service.from("restaurants").select("logo_url, primary_image_url").eq("id", input.restaurantId).maybeSingle()
  if (restaurantError || !restaurant) throw new Error(restaurantError?.message || "Restaurant not found.")

  let discovered: WebsiteImportResult
  try {
    discovered = input.discovered || await importRestaurantFromWebsite(input.officialWebsiteUrl, { maxDiscoveryPages: 2 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The official website could not be read."
    return { success: false, sourceUrl: input.officialWebsiteUrl, logo: { status: "failed", url: null, message }, primary: { status: "failed", url: null, message }, message }
  }

  const uploadedPaths: string[] = []
  const currentLogoUrl = getSafeRestaurantAssetUrl(restaurant.logo_url)
  const currentPrimaryUrl = getSafeRestaurantAssetUrl(restaurant.primary_image_url)
  const logoAlreadyPresent = Boolean(currentLogoUrl) && !input.overwrite
  const primaryAlreadyPresent = Boolean(currentPrimaryUrl) && !input.overwrite
  const preferredLogo = input.preferredLogoUrl ? discovered.logoCandidates.find((candidate) => candidate.url === input.preferredLogoUrl) || null : null
  const preferredPrimary = input.preferredPrimaryUrl ? discovered.bannerCandidates.find((candidate) => candidate.url === input.preferredPrimaryUrl) || null : null
  const uniqueCandidates = (preferred: WebsiteImportCandidate | null, candidates: WebsiteImportCandidate[]) => Array.from(new Map([preferred, ...candidates].filter((candidate): candidate is WebsiteImportCandidate => Boolean(candidate)).map((candidate) => [candidate.url, candidate])).values())
  const logoCandidates = uniqueCandidates(preferredLogo, discovered.logoCandidates)
  const primaryCandidates = uniqueCandidates(preferredPrimary, discovered.bannerCandidates)
  const logoResult = logoAlreadyPresent
    ? { upload: null, error: null }
    : await tryCandidates(service, input.workspaceId, input.restaurantId, "logo", logoCandidates)
  const primaryResult = primaryAlreadyPresent
    ? { upload: null, error: null }
    : await tryCandidates(service, input.workspaceId, input.restaurantId, "primary", primaryCandidates)
  if (logoResult.upload) uploadedPaths.push(logoResult.upload.path)
  if (primaryResult.upload) uploadedPaths.push(primaryResult.upload.path)

  const updates: Record<string, string> = {}
  if (logoResult.upload) updates.logo_url = logoResult.upload.publicUrl
  if (primaryResult.upload) updates.primary_image_url = primaryResult.upload.publicUrl
  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await service.from("restaurants").update(updates).eq("id", input.restaurantId)
    if (updateError) {
      if (uploadedPaths.length) await service.storage.from("restaurant-assets").remove(uploadedPaths)
      throw new Error(updateError.message)
    }
  }

  const logo = logoAlreadyPresent
    ? { status: "already_present" as const, url: currentLogoUrl }
    : logoResult.upload
      ? { status: "imported" as const, url: logoResult.upload.publicUrl }
      : { status: "not_found" as const, url: null, message: logoResult.error || undefined }
  const primary = primaryAlreadyPresent
    ? { status: "already_present" as const, url: currentPrimaryUrl }
    : primaryResult.upload
      ? { status: "imported" as const, url: primaryResult.upload.publicUrl }
      : { status: "not_found" as const, url: null, message: primaryResult.error || undefined }
  return { success: true, sourceUrl: discovered.sourceUrl, logo, primary }
}

export async function syncRestaurantWebsiteProfile(input: {
  restaurantId: string
  workspaceId: string
  officialWebsiteUrl: string
  overwrite?: boolean
  preferredLogoUrl?: string | null
  preferredPrimaryUrl?: string | null
}): Promise<{ assets: WebsiteAssetSyncResult; enrichment: RestaurantWebsiteEnrichmentResult }> {
  let discovered: WebsiteImportResult
  try {
    discovered = await importRestaurantFromWebsite(input.officialWebsiteUrl, { maxDiscoveryPages: 2 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The official website could not be read."
    return {
      assets: { success: false, sourceUrl: input.officialWebsiteUrl, logo: { status: "failed", url: null, message }, primary: { status: "failed", url: null, message }, message },
      enrichment: { success: false, updatedFields: [], skippedFields: [], message },
    }
  }

  let enrichment: RestaurantWebsiteEnrichmentResult
  try {
    enrichment = await enrichRestaurantWebsiteProfile({ restaurantId: input.restaurantId, sourceUrl: discovered.sourceUrl, discovered: discovered.profile })
  } catch (error) {
    enrichment = { success: false, updatedFields: [], skippedFields: [], message: error instanceof Error ? error.message : "Website profile data could not be saved." }
  }
  const assets = await syncRestaurantWebsiteAssets({ ...input, discovered })
  return { assets, enrichment }
}
