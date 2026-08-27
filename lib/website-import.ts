import "server-only"

import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

import {
  normalizeSocialLinks,
  slugifyRestaurantName,
  SOCIAL_PLATFORMS,
  type RestaurantSocialLinks,
} from "@/lib/restaurant-profile"

const MAX_HTML_BYTES = 1_500_000
const MAX_DISCOVERY_PAGES = 5
const FETCH_TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 3

type Confidence = "high" | "medium" | "low"

export type WebsiteImportCandidate = {
  url: string
  kind: "logo" | "banner"
  label: string
  source: string
}

export type WebsiteImportProfile = {
  name: string
  slug: string
  business_contact_email: string | null
  logo_url: string | null
  primary_image_url: string | null
  description: string | null
  cuisine: string | null
  atmosphere: string | null
  hours: string | null
  location: string | null
  phone: string | null
  whatsapp: string | null
  menu_url: string | null
  location_url: string | null
  events_url: string | null
  social_links: RestaurantSocialLinks
  timezone: string
  language: string
  address_line1?: string | null
  address_line2?: string | null
  address_locality?: string | null
  address_region?: string | null
  address_postal_code?: string | null
  address_country?: string | null
  latitude?: number | null
  longitude?: number | null
  official_website_url?: string | null
}

export type WebsiteImportResult = {
  sourceUrl: string
  crawledPages: number
  profile: WebsiteImportProfile
  logoCandidates: WebsiteImportCandidate[]
  bannerCandidates: WebsiteImportCandidate[]
  fields: Partial<Record<keyof WebsiteImportProfile, { source: string; confidence: Confidence }>>
  missingFields: Array<keyof WebsiteImportProfile>
}

type JsonRecord = Record<string, unknown>

type Page = {
  url: string
  html: string
}

type Anchor = {
  url: string
  text: string
}

type CandidateSeed = {
  url: string
  kind: "logo" | "banner"
  label: string
  source: string
}

function cleanText(value: string | null | undefined) {
  return decodeEntities(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    Ccedil: "Ç",
    ccedil: "ç",
    Gbreve: "Ğ",
    gbreve: "ğ",
    gt: ">",
    Idot: "İ",
    idot: "i",
    imath: "ı",
    lt: "<",
    nbsp: " ",
    quot: '"',
    Ouml: "Ö",
    ouml: "ö",
    Scedil: "Ş",
    scedil: "ş",
    Uuml: "Ü",
    uuml: "ü",
  }

  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (entity, token: string) => {
    if (token[0] === "#") {
      const hexadecimal = token[1]?.toLowerCase() === "x"
      const number = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity
    }
    return named[token] || named[token.toLowerCase()] || entity
  })
}

function getAttribute(tag: string, attribute: string) {
  const quoted = new RegExp(`${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag)
  if (quoted?.[2]) return decodeEntities(quoted[2])
  const unquoted = new RegExp(`${attribute}\\s*=\\s*([^\\s>]+)`, "i").exec(tag)
  return unquoted?.[1] ? decodeEntities(unquoted[1]) : null
}

function getTags(html: string, tagName: string) {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) || []
}

function getMeta(html: string, names: string[]) {
  const accepted = new Set(names.map((name) => name.toLowerCase()))
  for (const tag of getTags(html, "meta")) {
    const key = getAttribute(tag, "property") || getAttribute(tag, "name") || getAttribute(tag, "itemprop")
    const content = getAttribute(tag, "content")
    if (key && content && accepted.has(key.toLowerCase())) return cleanText(content)
  }
  return null
}

function readabilityPenalty(value: string) {
  return (value.match(/(?:\uFFFD|ï¿½|Ã.|Â.|â[\u0080-\u00ff]|&[A-Za-z][A-Za-z0-9]+;)/gu) || []).length
}

function bestReadableText(values: Array<string | null | undefined>) {
  const candidates = values.map((value) => cleanText(value)).filter(Boolean)
  return candidates.sort((left, right) => readabilityPenalty(left) - readabilityPenalty(right))[0] || null
}

function getTagText(html: string, tagName: string) {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(html)
  return match?.[1] ? cleanText(match[1].replace(/<[^>]+>/g, " ")) : null
}

function getTagContents(html: string, tagName: string) {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi")) || []
}

function visibleText(html: string) {
  return cleanText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
}

function getFirstParagraph(html: string) {
  const paragraphs = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []
  return paragraphs
    .map((paragraph) => cleanText(paragraph.replace(/<[^>]+>/g, " ")))
    .find((paragraph) => paragraph.length >= 45 && paragraph.length <= 2_000) || null
}

function absoluteUrl(value: string | null | undefined, baseUrl: string) {
  if (!value || /^(?:data|blob|javascript|mailto|tel):/i.test(value.trim())) return null
  try {
    const url = new URL(value.trim(), baseUrl)
    if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return null
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function isBlockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true
  if (["::", "::1", "0.0.0.0", "127.0.0.1"].includes(host)) return true
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host) || /^2001:db8:/i.test(host)) return true
  const mappedIpv4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  if (mappedIpv4) return isBlockedHostname(mappedIpv4)
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number)
    if (parts.length === 4 && (parts[0] === 0 || parts[0] === 10 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 0 && parts[2] === 0 || parts[0] === 192 && parts[1] === 168 || parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19 || parts[0] === 198 && parts[1] === 51 && parts[2] === 100 || parts[0] === 203 && parts[1] === 0 && parts[2] === 113 || parts[0] >= 224)) return true
  }
  const private172 = /^172\.(\d{1,3})\./.exec(host)?.[1]
  if (private172 && Number(private172) >= 16 && Number(private172) <= 31) return true
  return false
}

async function assertPublicWebsiteHost(value: string) {
  const url = new URL(value)
  if (isBlockedHostname(url.hostname)) throw new Error("The website resolved to a private address.")
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some((entry) => isBlockedHostname(entry.address))) throw new Error("The website resolved to a private address.")
  } catch (error) {
    if (error instanceof Error && error.message.includes("private")) throw error
    throw new Error("The website host could not be verified.")
  }
}

async function readLimitedBytes(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length") || 0)
  if (contentLength > maxBytes) throw new Error("The website response is too large.")
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.length > maxBytes ? bytes.slice(0, maxBytes) : bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error("The website response is too large.")
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

function normalizeCharsetLabel(value: string | null) {
  if (!value) return null
  const label = value.trim().toLowerCase()
  if (["utf8", "utf-8"].includes(label)) return "utf-8"
  if (["iso-8859-9", "iso8859-9", "latin5", "l5", "windows-1254", "cp1254"].includes(label)) return "windows-1254"
  if (["iso-8859-1", "iso8859-1", "latin1", "windows-1252", "cp1252"].includes(label)) return "windows-1252"
  return label
}

function findDeclaredCharset(contentType: string, bytes: Uint8Array) {
  const headerCharset = /(?:^|;)\s*charset\s*=\s*["']?\s*([^\s;"']+)/i.exec(contentType)?.[1]
  if (headerCharset) return normalizeCharsetLabel(headerCharset)

  // Charset declarations are ASCII-compatible, so a short Windows-1252 view
  // is enough to inspect them before the document's real encoding is known.
  const head = new TextDecoder("windows-1252").decode(bytes.slice(0, 16_384))
  const metaCharset = /<meta\b[^>]*charset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(head)?.[1]
    || /<meta\b[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^\s;"']+)/i.exec(head)?.[1]
  return normalizeCharsetLabel(metaCharset || null)
}

function detectBom(bytes: Uint8Array) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8"
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le"
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be"
  return null
}

function decodeHtml(bytes: Uint8Array, contentType: string) {
  const encoding = detectBom(bytes) || findDeclaredCharset(contentType, bytes) || "utf-8"
  const decode = (label: string) => {
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      return null
    }
  }

  const decoded = decode(encoding) || decode("utf-8") || ""
  if (!decoded.includes("\uFFFD") || encoding !== "utf-8") return decoded

  // A number of Turkish sites omit their charset and still serve ISO-8859-9
  // or Windows-1254 bytes. UTF-8 turns those bytes into replacement markers;
  // prefer the Turkish legacy decoder when it recovers actual Turkish text.
  const legacy = decode("windows-1254")
  return legacy && /[ğĞüÜşŞıİöÖçÇ]/u.test(legacy) ? legacy : decoded
}

function normalizeWebsiteUrl(input: string) {
  const trimmed = input.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withProtocol)
  if (!/^https?:$/i.test(url.protocol) || url.username || url.password || isBlockedHostname(url.hostname)) {
    throw new Error("Enter a public website URL.")
  }
  url.hash = ""
  return url.toString()
}

async function fetchPage(inputUrl: string): Promise<Page> {
  let currentUrl = inputUrl

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicWebsiteHost(currentUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(currentUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Reservevia Website Importer/1.0 (+https://reservevia.app)",
        },
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        const nextUrl = absoluteUrl(location, currentUrl)
        if (!nextUrl) throw new Error("The website returned an invalid redirect.")
        const parsedNextUrl = new URL(nextUrl)
        if (isBlockedHostname(parsedNextUrl.hostname)) throw new Error("The website redirected to a private address.")
        currentUrl = nextUrl
        continue
      }

      if (!response.ok) throw new Error(`The website returned ${response.status}.`)
      const contentType = response.headers.get("content-type") || ""
      if (contentType && !/html|xhtml/i.test(contentType)) throw new Error("The link does not point to a webpage.")

      const bytes = await readLimitedBytes(response, MAX_HTML_BYTES)
      return { url: currentUrl, html: decodeHtml(bytes, contentType) }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("The website took too long to respond.")
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error("Too many website redirects.")
}

function extractAnchors(html: string, baseUrl: string): Anchor[] {
  return (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [])
    .map((tag) => {
      const openingTag = tag.match(/^<a\b[^>]*>/i)?.[0] || tag
      const url = absoluteUrl(getAttribute(openingTag, "href"), baseUrl)
      const text = cleanText(tag.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, "").replace(/<[^>]+>/g, " "))
      return url ? { url, text } : null
    })
    .filter((anchor): anchor is Anchor => Boolean(anchor))
}

function extractImages(html: string, baseUrl: string) {
  const images: Array<{ url: string; hint: string }> = []
  for (const tag of [...getTags(html, "img"), ...getTags(html, "source")]) {
    const raw = getAttribute(tag, "src") || getAttribute(tag, "data-src") || getAttribute(tag, "srcset")?.split(",")[0]?.trim().split(" ")[0]
    const url = absoluteUrl(raw, baseUrl)
    if (!url) continue
    images.push({
      url,
      hint: `${getAttribute(tag, "alt") || ""} ${getAttribute(tag, "class") || ""} ${getAttribute(tag, "id") || ""} ${url}`.toLowerCase(),
    })
  }
  return images
}

function extractIconLinks(html: string, baseUrl: string) {
  return getTags(html, "link")
    .filter((tag) => /icon/i.test(getAttribute(tag, "rel") || ""))
    .map((tag) => absoluteUrl(getAttribute(tag, "href"), baseUrl))
    .filter((url): url is string => Boolean(url))
}

function extractJsonLd(html: string): JsonRecord[] {
  const records: JsonRecord[] = []
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== "object") return
    records.push(value as JsonRecord)
    Object.values(value as JsonRecord).forEach((child) => {
      if (child && typeof child === "object") visit(child)
    })
  }

  for (const script of scripts) {
    const content = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim()
    try {
      visit(JSON.parse(content))
    } catch {
      // Some sites include a trailing comma or templating token. Other sources
      // are still useful, so a malformed JSON-LD block is intentionally ignored.
    }
  }
  return records
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value)
  if (Array.isArray(value)) return value.map(asString).find(Boolean) || null
  return null
}

function asStringArray(value: unknown) {
  if (typeof value === "string") return [cleanText(value)]
  if (!Array.isArray(value)) return []
  return value.map(asString).filter((item): item is string => Boolean(item))
}

function findRestaurantJsonLd(records: JsonRecord[]) {
  const restaurant = records.find((record) => {
    const type = asStringArray(record["@type"]).join(" ").toLowerCase()
    return /restaurant|foodestablishment|localbusiness/.test(type) || Boolean(record.servesCuisine || record.openingHours || record.address)
  })
  if (restaurant) return restaurant

  const organization = records.find((record) => /organization|website/.test(asStringArray(record["@type"]).join(" ").toLowerCase()) && Boolean(record.logo || record.sameAs))
  return organization || records[0] || {}
}

function jsonImageUrls(record: JsonRecord, baseUrl: string) {
  const values = [record.logo, record.image, ...(Array.isArray(record.photo) ? record.photo : [record.photo])]
  return values
    .flatMap((value) => {
      if (typeof value === "string") return [value]
      if (value && typeof value === "object") return [asString((value as JsonRecord).url), asString((value as JsonRecord).contentUrl)]
      return []
    })
    .map((value) => absoluteUrl(value, baseUrl))
    .filter((url): url is string => Boolean(url))
}

function formatAddress(value: unknown) {
  if (typeof value === "string") return cleanText(value)
  if (!value || typeof value !== "object") return null
  const record = value as JsonRecord
  return [record.streetAddress, record.addressLocality, record.addressRegion, record.postalCode, record.addressCountry]
    .map(asString)
    .filter((part): part is string => Boolean(part))
    .join(", ") || null
}

function structuredAddress(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { line1: null, locality: null, region: null, postalCode: null, country: null }
  }
  const record = value as JsonRecord
  return {
    line1: asString(record.streetAddress),
    locality: asString(record.addressLocality),
    region: asString(record.addressRegion),
    postalCode: asString(record.postalCode),
    country: asString(record.addressCountry),
  }
}

function structuredCoordinates(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { latitude: null, longitude: null }
  const record = value as JsonRecord
  const latitude = Number(record.latitude)
  const longitude = Number(record.longitude)
  return {
    latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null,
  }
}

function formatHours(record: JsonRecord) {
  const direct = asStringArray(record.openingHours)
  if (direct.length) return direct.join(" · ")
  if (!Array.isArray(record.openingHoursSpecification)) return null
  const ranges = record.openingHoursSpecification
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const value = item as JsonRecord
      const days = asStringArray(value.dayOfWeek).join(", ")
      const opens = asString(value.opens)
      const closes = asString(value.closes)
      return [days, opens && closes ? `${opens}–${closes}` : null].filter(Boolean).join(" ") || null
    })
    .filter((item): item is string => Boolean(item))
  return ranges.length ? ranges.join(" · ") : null
}

function inferHours(text: string) {
  const match = text.match(/\b((?:[01]?\d|2[0-4])[:.][0-5]\d)\s*(?:[–—-]\s*|[^\d]{1,24}?)(?:((?:[01]?\d|2[0-4])[:.][0-5]\d))\b/)
  return match ? `${match[1]}–${match[2]}` : null
}

function inferPhone(text: string) {
  const match = text.match(/(?:\+90|0)\s*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/)
  return match ? cleanText(match[0]) : null
}

function extractPhoneFromLinks(html: string) {
  for (const tag of getTagContents(html, "a")) {
    const openingTag = tag.match(/^<a\b[^>]*>/i)?.[0] || tag
    const href = getAttribute(openingTag, "href")
    if (!href || !/^tel:/i.test(href)) continue
    const value = href.replace(/^tel:/i, "")
    try {
      return cleanText(decodeURIComponent(value)) || null
    } catch {
      return cleanText(value) || null
    }
  }
  return null
}

function normalizeEmailCandidate(value: string | null | undefined) {
  if (!value) return null
  const decoded = decodeEntities(value).replace(/^mailto:/i, "").split(/[?#]/, 1)[0].trim()
  const match = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?.[0]?.toLowerCase() || null
}

function extractEmailFromLinks(html: string) {
  for (const tag of getTagContents(html, "a")) {
    const openingTag = tag.match(/^<a\b[^>]*>/i)?.[0] || tag
    const href = getAttribute(openingTag, "href")
    const hrefEmail = normalizeEmailCandidate(href?.match(/^mailto:/i) ? href : null)
    if (hrefEmail) return hrefEmail
    const textEmail = normalizeEmailCandidate(cleanText(tag.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, "").replace(/<[^>]+>/g, " ")))
    if (textEmail) return textEmail
  }
  return null
}

function inferEmail(text: string) {
  return normalizeEmailCandidate(text)
}

function inferAddress(html: string) {
  const candidates = getTagContents(html, "p")
    .map((tag) => cleanText(tag.replace(/<[^>]+>/g, " ")))
    .filter((text) => text.length >= 20 && text.length <= 240)
    .filter((text) => /\b\d{5}\b/.test(text) || /\b(?:cad(?:desi)?|sok(?:ak)?|bulvarı|mah(?:allesi)?|no\.?|istanbul|ankara|izmir|antalya)\b/i.test(text))
  if (candidates[0]) return candidates[0]

  const plainText = visibleText(html)
  const addressMatch = plainText.match(/((?:[\p{L}0-9]+[\s/,-]+){1,6}(?:Mahallesi|Caddesi|Sokak|Bulvarı|No\s*[:.]?)[^.!?]{0,180}(?:İstanbul|Beyoğlu|Ankara|İzmir|Antalya))/iu)
  return addressMatch?.[1] ? cleanText(addressMatch[1]) : null
}

function platformForUrl(value: string): (typeof SOCIAL_PLATFORMS)[number] | null {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "")
    if (host === "instagram.com") return "instagram"
    if (host === "facebook.com" || host === "fb.com") return "facebook"
    if (host === "tiktok.com") return "tiktok"
    if (host === "youtube.com" || host === "youtu.be") return "youtube"
    if (host === "x.com" || host === "twitter.com") return "x"
    return null
  } catch {
    return null
  }
}

function relevantPage(anchor: Anchor) {
  const text = `${anchor.text} ${anchor.url}`.toLowerCase()
  return /about|contact|menu|restaurant|story|event|location|hours|visit/.test(text)
}

function inferAtmosphere(text: string) {
  const hints: Array<[RegExp, string]> = [
    [/beach|beachfront|sahil|deniz|marina/i, "Beachfront"],
    [/garden|bahçe|botanical/i, "Garden"],
    [/rooftop|teras|terrace/i, "Rooftop terrace"],
    [/fine dining|şık|elegant/i, "Fine dining"],
    [/casual|samimi|relaxed/i, "Casual"],
    [/family|aile dostu/i, "Family friendly"],
  ]
  return hints.find(([pattern]) => pattern.test(text))?.[1] || null
}

function inferCuisine(record: JsonRecord, text: string) {
  const direct = asString(record.servesCuisine)
  if (direct) return direct
  const keywords: Array<[RegExp, string]> = [
    [/turkish|türk/i, "Turkish"],
    [/italian|italyan/i, "Italian"],
    [/mediterranean|akdeniz/i, "Mediterranean"],
    [/seafood|deniz ürünleri|balık/i, "Seafood"],
    [/japanese|japon/i, "Japanese"],
    [/mexican|meksika/i, "Mexican"],
    [/vegan/i, "Vegan"],
    [/steak/i, "Steakhouse"],
  ]
  return keywords.find(([pattern]) => pattern.test(text))?.[1] || null
}

function candidateList(seeds: CandidateSeed[], kind: CandidateSeed["kind"]) {
  const seen = new Set<string>()
  return seeds
    .filter((seed) => seed.kind === kind)
    .filter((seed) => {
      if (seen.has(seed.url)) return false
      seen.add(seed.url)
      return true
    })
    .slice(0, 6)
    .map((seed) => ({ url: seed.url, kind: seed.kind, label: seed.label, source: seed.source }))
}

function fallbackName(url: string) {
  const host = new URL(url).hostname.replace(/^www\./i, "").split(".")[0]
  return host.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Restaurant"
}

function normalizeTitleName(value: string | null) {
  const title = cleanText(value)
  return title.split(/\s+(?:[-|–—]|·)\s+/)[0]?.trim() || null
}

function trimField(value: string | null, maxLength = 600) {
  if (!value) return null
  const cleaned = cleanText(value)
  return cleaned ? cleaned.slice(0, maxLength).trim() : null
}

function isDecorativeImage(url: string) {
  return /scroll[-_ ]?down|favicon|placeholder|spinner|loader|tracking|pixel/i.test(url)
}

export type WebsiteImportOptions = {
  maxDiscoveryPages?: number
}

export async function importRestaurantFromWebsite(input: string, options: WebsiteImportOptions = {}): Promise<WebsiteImportResult> {
  const sourceUrl = normalizeWebsiteUrl(input)
  const maxDiscoveryPages = Math.min(Math.max(Math.floor(options.maxDiscoveryPages || MAX_DISCOVERY_PAGES), 0), MAX_DISCOVERY_PAGES)
  const home = await fetchPage(sourceUrl)
  const homeAnchors = extractAnchors(home.html, home.url)
  const sourceOrigin = new URL(home.url).origin
  const discoveryUrls = Array.from(new Set(
    homeAnchors
      .filter(relevantPage)
      .map((anchor) => anchor.url)
      .filter((url) => {
        try {
          return new URL(url).origin === sourceOrigin
        } catch {
          return false
        }
      }),
  )).slice(0, maxDiscoveryPages)

  const discoveredPages = await Promise.allSettled(discoveryUrls.map((url) => fetchPage(url)))
  const pages = [home, ...discoveredPages.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])]
  const combinedHtml = pages.map((page) => page.html).join("\n")
  const records = extractJsonLd(combinedHtml)
  const structured = findRestaurantJsonLd(records)
  const allAnchors = pages.flatMap((page) => extractAnchors(page.html, page.url))
  const allImages = pages.flatMap((page) => extractImages(page.html, page.url))
  const homeTitle = getTagText(home.html, "title")
  const name = trimField(bestReadableText([
    asString(structured.name),
    getMeta(home.html, ["og:site_name"]),
    normalizeTitleName(getMeta(home.html, ["og:title"])),
    normalizeTitleName(homeTitle),
    getTagText(combinedHtml, "h1"),
    fallbackName(home.url),
  ]), 120) || "Restaurant"
  const description = trimField(bestReadableText([
    asString(structured.description),
    getMeta(home.html, ["description", "og:description"]),
    getFirstParagraph(combinedHtml),
  ]))
  const jsonImages = jsonImageUrls(structured, home.url)
  const ogImage = absoluteUrl(getMeta(home.html, ["og:image", "twitter:image"]), home.url)
  const ogLogo = absoluteUrl(getMeta(home.html, ["og:logo", "logo"]), home.url)
  const iconLinks = extractIconLinks(home.html, home.url)
  const imageSeeds: CandidateSeed[] = [
    ...(ogLogo ? [{ url: ogLogo, kind: "logo" as const, label: "Website logo", source: "Open Graph" }] : []),
    ...jsonImageUrls(structured, home.url).filter((url) => /logo|brand|mark/i.test(url)).map((url) => ({ url, kind: "logo" as const, label: "Structured data logo", source: "Website data" })),
    ...allImages.filter((image) => /logo|brand|mark|icon/.test(image.hint)).map((image) => ({ url: image.url, kind: "logo" as const, label: "Logo candidate", source: "Website image" })),
    ...iconLinks.map((url) => ({ url, kind: "logo" as const, label: "Website icon", source: "Favicon" })),
    ...(ogImage && !isDecorativeImage(ogImage) ? [{ url: ogImage, kind: "banner" as const, label: "Website cover image", source: "Open Graph" }] : []),
    ...jsonImages.filter((url) => !isDecorativeImage(url) && !/logo|brand|mark/i.test(url)).map((url) => ({ url, kind: "banner" as const, label: "Restaurant image", source: "Website data" })),
    ...allImages.filter((image) => !isDecorativeImage(image.url) && !/logo|brand|mark|icon|avatar|favicon/.test(image.hint)).map((image) => ({ url: image.url, kind: "banner" as const, label: "Website image", source: "Website image" })),
  ]
  const logoCandidates = candidateList(imageSeeds, "logo")
  const bannerCandidates = candidateList(imageSeeds, "banner")
  const allText = cleanText(`${visibleText(combinedHtml)} ${name} ${description || ""}`)
  const socialLinks: RestaurantSocialLinks = { website: home.url }
  for (const value of [...asStringArray(structured.sameAs), ...allAnchors.map((anchor) => anchor.url)]) {
    const platform = platformForUrl(value)
    if (platform && !socialLinks[platform]) socialLinks[platform] = value
  }

  const phone = trimField(asString(structured.telephone) || extractPhoneFromLinks(combinedHtml) || inferPhone(allText), 80)
  const businessContactEmail = normalizeEmailCandidate(asString(structured.email) || getMeta(combinedHtml, ["email", "og:email"]) || extractEmailFromLinks(combinedHtml) || inferEmail(allText))
  const address = structuredAddress(structured.address)
  const coordinates = structuredCoordinates(structured.geo)
  const location = trimField(formatAddress(structured.address) || getMeta(home.html, ["geo.placename", "og:street-address"]) || inferAddress(combinedHtml), 240)
  const menuUrl = allAnchors.find((anchor) => /menu|menü|carta/.test(`${anchor.text} ${anchor.url}`.toLowerCase()))?.url || null
  const locationUrl = absoluteUrl(asString(structured.hasMap) || asString(structured.map), home.url) || allAnchors.find((anchor) => /maps\.app\.goo\.gl|google\.[^/]+\/maps|maps\.google|maps\.apple|waze\.com/.test(anchor.url))?.url || null
  const eventsUrl = allAnchors.find((anchor) => /event|etkinlik|calendar/.test(`${anchor.text} ${anchor.url}`.toLowerCase()))?.url || null
  const language = getAttribute(home.html.match(/<html\b[^>]*>/i)?.[0] || "", "lang")?.split("-")[0] || "en"
  const profile: WebsiteImportProfile = {
    name,
    slug: slugifyRestaurantName(name),
    business_contact_email: businessContactEmail,
    logo_url: logoCandidates[0]?.url || null,
    primary_image_url: bannerCandidates[0]?.url || null,
    description,
    cuisine: trimField(inferCuisine(structured, allText), 120),
    atmosphere: trimField(inferAtmosphere(allText), 120),
    hours: trimField(formatHours(structured) || inferHours(allText), 300),
    location,
    phone,
    whatsapp: phone,
    menu_url: menuUrl,
    location_url: locationUrl,
    events_url: eventsUrl,
    social_links: normalizeSocialLinks(socialLinks),
    timezone: "UTC",
    language: language || "en",
    address_line1: trimField(address.line1, 180),
    address_line2: null,
    address_locality: trimField(address.locality, 120),
    address_region: trimField(address.region, 120),
    address_postal_code: trimField(address.postalCode, 32),
    address_country: trimField(address.country, 80),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    official_website_url: home.url,
  }

  const fields: WebsiteImportResult["fields"] = {}
  const addField = (key: keyof WebsiteImportProfile, value: unknown, source: string, confidence: Confidence) => {
    if (value !== null && value !== undefined && value !== "") fields[key] = { source, confidence }
  }
  addField("name", profile.name, "Website title or structured data", "high")
  addField("logo_url", profile.logo_url, logoCandidates[0]?.source || "Website", logoCandidates[0]?.source === "Favicon" ? "low" : "medium")
  addField("primary_image_url", profile.primary_image_url, bannerCandidates[0]?.source || "Website", bannerCandidates[0]?.source === "Open Graph" ? "high" : "medium")
  addField("description", profile.description, "Website description", "high")
  addField("cuisine", profile.cuisine, "Website content", "low")
  addField("atmosphere", profile.atmosphere, "Website content", "low")
  addField("hours", profile.hours, "Restaurant structured data", "high")
  addField("location", profile.location, "Restaurant structured data", "high")
  addField("phone", profile.phone, "Restaurant structured data or contact link", "high")
  addField("business_contact_email", profile.business_contact_email, "Restaurant website contact", "high")
  addField("menu_url", profile.menu_url, "Website navigation", "medium")
  addField("location_url", profile.location_url, "Website navigation", "medium")
  addField("events_url", profile.events_url, "Website navigation", "medium")
  addField("social_links", Object.keys(profile.social_links).length > 1 ? profile.social_links : null, "Website social links", "high")
  addField("address_line1", profile.address_line1, "Restaurant structured data", "high")
  addField("address_locality", profile.address_locality, "Restaurant structured data", "high")
  addField("address_region", profile.address_region, "Restaurant structured data", "high")
  addField("address_postal_code", profile.address_postal_code, "Restaurant structured data", "high")
  addField("address_country", profile.address_country, "Restaurant structured data", "high")
  addField("latitude", profile.latitude, "Restaurant structured data", "high")
  addField("longitude", profile.longitude, "Restaurant structured data", "high")
  addField("official_website_url", profile.official_website_url, "Scanned official website", "high")

  const missingFields = (["description", "logo_url", "primary_image_url", "cuisine", "atmosphere", "hours", "location", "phone", "menu_url", "location_url"] as const)
    .filter((key) => !profile[key])

  return {
    sourceUrl: home.url,
    crawledPages: pages.length,
    profile,
    logoCandidates,
    bannerCandidates,
    fields,
    missingFields,
  }
}
