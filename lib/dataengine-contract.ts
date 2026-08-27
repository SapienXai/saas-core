import { z } from "zod"

export const DATAENGINE_CONTRACT_VERSION = "reservevia.dataengine.leads.v1" as const

const evidenceSchema = z.object({
  field: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(4000),
  source_url: z.string().url().max(2000).optional(),
  source_type: z.string().trim().max(80).optional(),
  extraction_method: z.string().trim().max(80).optional(),
  confidence: z.enum(["high", "medium_high", "medium", "low"]).optional(),
  business_match: z.enum(["strong", "probable", "ambiguous", "mismatch"]).optional(),
  scope: z.enum(["venue", "parent_global", "other_venue", "unknown"]).optional(),
  observed_at: z.string().datetime().optional(),
}).strict()

const websiteDataSchema = z.object({
  canonical_url: z.string().url().max(2000).optional(),
  official_domain: z.string().trim().max(253).optional(),
  site_name: z.string().trim().max(240).optional(),
  emails: z.array(z.string().email().max(320)).max(20).default([]),
  phones: z.array(z.string().trim().max(80)).max(20).default([]),
  menu_urls: z.array(z.string().url().max(2000)).max(20).default([]),
  reservation_urls: z.array(z.string().url().max(2000)).max(20).default([]),
  reservation_provider: z.string().trim().max(120).optional(),
  opening_hours: z.array(z.string().trim().max(240)).max(50).default([]),
  address: z.string().trim().max(500).optional(),
  cuisine: z.array(z.string().trim().max(120)).max(20).default([]),
  logo_url: z.string().url().max(2000).optional(),
  hero_image_url: z.string().url().max(2000).optional(),
  description: z.string().trim().max(2000).optional(),
}).strict()

const bannerSchema = z.object({
  source_type: z.enum(["official_hero", "official_og", "official_image", "homepage_screenshot"]),
  url: z.string().url().max(2000).optional(),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]).optional(),
  width: z.number().int().positive().max(10000).optional(),
  height: z.number().int().positive().max(10000).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict()

export const dataEngineLeadSchema = z.object({
  candidate_id: z.string().trim().min(1).max(200),
  place_id: z.string().trim().max(300).optional(),
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().max(160).optional(),
  address: z.string().trim().max(500).optional(),
  official_website_url: z.string().url().max(2000).optional(),
  official_domain: z.string().trim().max(253).optional(),
  candidate_status: z.enum(["new", "shortlisted", "contacted", "excluded"]).default("new"),
  classification: z.enum(["best_matches", "potential", "review", "excluded"]).optional(),
  fit_score: z.number().int().min(0).max(100).optional(),
  data_confidence: z.number().int().min(0).max(100).optional(),
  scoring_version: z.string().trim().max(120).optional(),
  enrichment_status: z.string().trim().max(80).optional(),
  business_match: z.enum(["strong", "probable", "ambiguous", "mismatch"]).optional(),
  website_data: websiteDataSchema.default({ emails: [], phones: [], menu_urls: [], reservation_urls: [], opening_hours: [], cuisine: [] }),
  evidence: z.array(evidenceSchema).max(500).default([]),
  banner: bannerSchema.optional(),
  source_search_ids: z.array(z.string().trim().max(200)).max(100).default([]),
  location: z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }).strict().optional(),
}).strict()

export const dataEngineBatchSchema = z.object({
  contract_version: z.literal(DATAENGINE_CONTRACT_VERSION),
  batch_id: z.string().trim().min(1).max(200),
  source_run_id: z.string().trim().max(200).optional(),
  source_export_id: z.string().trim().max(200).optional(),
  scoring_version: z.string().trim().max(120).optional(),
  generated_at: z.string().datetime().optional(),
  leads: z.array(dataEngineLeadSchema).min(1).max(250),
}).strict().superRefine((batch, context) => {
  const seen = new Set<string>()
  batch.leads.forEach((lead, index) => {
    if (seen.has(lead.candidate_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["leads", index, "candidate_id"], message: "candidate_id must be unique within a batch." })
    }
    seen.add(lead.candidate_id)
  })
})

export type DataEngineEvidence = z.infer<typeof evidenceSchema>
export type DataEngineWebsiteData = z.infer<typeof websiteDataSchema>
export type DataEngineLead = z.infer<typeof dataEngineLeadSchema>
export type DataEngineBatch = z.infer<typeof dataEngineBatchSchema>

export type DataEngineReadiness = "ready" | "needs_data" | "needs_review" | "duplicate" | "rejected"
export type DataEngineReviewStatus = "pending" | "approved" | "rejected" | "published"

export type DataEngineReadinessContext = {
  hasBanner?: boolean
  verifiedWebsite?: boolean
  hasIdentityConflict?: boolean
  manualOverrideReason?: string | null
}

export function normalizeDataEngineDomain(value: string | null | undefined) {
  const candidate = value?.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || ""
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(candidate) ? candidate : null
}

export function normalizeDataEngineText(value: string | null | undefined) {
  return (value || "").toLocaleLowerCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim()
}

export function dataEngineNameAddressKey(name: string | null | undefined, address: string | null | undefined) {
  const normalizedName = normalizeDataEngineText(name)
  const normalizedAddress = normalizeDataEngineText(address)
  return normalizedName && normalizedAddress ? `${normalizedName}|${normalizedAddress}` : null
}

export function officialWebsiteEvidence(evidence: DataEngineEvidence[], officialDomain: string | null) {
  if (!officialDomain) return []
  return evidence.filter((item) => {
    if (!item.source_url) return false
    try {
      const sourceDomain = normalizeDataEngineDomain(new URL(item.source_url).hostname)
      const sameOfficialSite = Boolean(sourceDomain && (sourceDomain === officialDomain || sourceDomain.endsWith(`.${officialDomain}`)))
      const sourceType = item.source_type?.trim().toLowerCase()
      const trustedSourceType = !sourceType || ["official_website", "official_site", "website"].includes(sourceType)
      return sameOfficialSite && trustedSourceType && item.scope !== "other_venue" && item.scope !== "parent_global" && (item.business_match === "strong" || item.business_match === "probable" || !item.business_match)
    } catch {
      return false
    }
  })
}

export function hasVerifiedBusinessEmail(lead: DataEngineLead) {
  const domain = normalizeDataEngineDomain(lead.official_domain || (lead.official_website_url ? new URL(lead.official_website_url).hostname : null))
  if (!domain) return false
  const evidence = officialWebsiteEvidence(lead.evidence, domain).filter((item) => item.scope === "venue" && ["email", "emails", "business_contact_email"].includes(item.field) && (item.confidence === "high" || item.confidence === "medium_high"))
  // A first-party website may publish a Gmail/Outlook mailbox. That is valid
  // for reservation notifications, but it must not weaken the separate
  // official-domain ownership rules used by the claim flow.
  return evidence.some((item) => lead.website_data.emails.some((email) => email.toLowerCase() === item.value.toLowerCase()))
}

export function getFirstVerifiedBusinessEmail(lead: DataEngineLead) {
  if (!hasVerifiedBusinessEmail(lead)) return null
  const domain = normalizeDataEngineDomain(lead.official_domain || (lead.official_website_url ? new URL(lead.official_website_url).hostname : null))
  const evidence = officialWebsiteEvidence(lead.evidence, domain).filter((item) => item.scope === "venue" && ["email", "emails", "business_contact_email"].includes(item.field) && (item.confidence === "high" || item.confidence === "medium_high"))
  return lead.website_data.emails.find((email) => evidence.some((item) => item.value.toLowerCase() === email.toLowerCase()))?.toLowerCase() || null
}

function hasReliableEnrichmentStatus(value: string | null | undefined) {
  return ["enriched", "verified", "complete", "fully_enriched", "high_confidence"].includes(value?.trim().toLowerCase() || "")
}

function hasOfficialNameEvidence(lead: DataEngineLead, officialDomain: string | null) {
  const siteName = lead.website_data.site_name?.trim()
  if (!siteName || !officialDomain) return false
  return officialWebsiteEvidence(lead.evidence, officialDomain).some((item) =>
    ["name", "site_name", "business_name", "restaurant_name"].includes(item.field.trim().toLowerCase()) &&
    (item.confidence === "high" || item.confidence === "medium_high") &&
    item.scope === "venue" &&
    (item.business_match === "strong" || !item.business_match) &&
    item.value.trim().toLowerCase() === siteName.toLowerCase(),
  )
}

export function deriveDataEngineReadiness(lead: DataEngineLead, hasBanner: boolean, context: DataEngineReadinessContext = {}): { status: DataEngineReadiness; reason: string | null; businessEmail: string | null; officialDomain: string | null } {
  if (lead.candidate_status === "excluded" || lead.classification === "excluded") return { status: "rejected", reason: "DataEngine candidate is excluded.", businessEmail: null, officialDomain: null }
  const officialDomain = normalizeDataEngineDomain(lead.official_domain || (lead.official_website_url ? new URL(lead.official_website_url).hostname : null))
  const email = getFirstVerifiedBusinessEmail(lead)
  const missing: string[] = []
  if (!lead.official_website_url || !officialDomain) missing.push("official website")
  if (!email) missing.push("verified first-party business email")
  if (!context.verifiedWebsite) missing.push("verified official website/domain")
  if (!hasOfficialNameEvidence(lead, officialDomain)) missing.push("official website name evidence")
  if (!hasBanner) missing.push("stored banner")
  if (missing.length > 0) return { status: "needs_data", reason: `Missing ${missing.join(", ")}.`, businessEmail: email, officialDomain }
  if (context.hasIdentityConflict) return { status: "needs_review", reason: "Identity or venue conflict requires operator review.", businessEmail: email, officialDomain }
  const qualityGateFailed = lead.business_match !== "strong" || !hasReliableEnrichmentStatus(lead.enrichment_status) || (lead.data_confidence ?? 0) < 80
  if (qualityGateFailed && !context.manualOverrideReason?.trim()) return { status: "needs_review", reason: "Strong business match, reliable enrichment, and Data Confidence >= 80 are required.", businessEmail: email, officialDomain }
  if (context.manualOverrideReason?.trim()) return { status: "ready", reason: `Manually overridden: ${context.manualOverrideReason.trim()}`, businessEmail: email, officialDomain }
  return { status: "ready", reason: null, businessEmail: email, officialDomain }
}
