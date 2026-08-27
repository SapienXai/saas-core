import "server-only"

import { createHash, randomUUID } from "node:crypto"
import sharp from "sharp"
import { ApiDomainError } from "@/lib/ai/contracts"
import { createServiceRoleClient } from "@/lib/supabase"
import { getRestaurantPublicUrl } from "@/lib/domains/public-url"
import { assertSafeOfficialWebsiteUrl, fetchVerifiedWebsiteImage, uploadVerifiedWebsiteImage, type WebsiteImageFile } from "@/lib/restaurant-website-assets"
import { importRestaurantFromWebsite } from "@/lib/website-import"
import {
  DATAENGINE_CONTRACT_VERSION,
  dataEngineBatchSchema,
  dataEngineLeadSchema,
  deriveDataEngineReadiness,
  getFirstVerifiedBusinessEmail,
  normalizeDataEngineDomain,
  dataEngineNameAddressKey,
  type DataEngineLead,
} from "@/lib/dataengine-contract"

const DATAENGINE_ASSET_BUCKET = "dataengine-import-assets"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BATCH_LEADS = 250
const MAX_BANNER_WIDTH = 2400
const MIN_BANNER_WIDTH = 1200
const MIN_BANNER_HEIGHT = 450
const MIN_BANNER_RATIO = 1.4
const MAX_BANNER_RATIO = 3.2

type Db = ReturnType<typeof createServiceRoleClient> & { from(table: string): any }

function db() {
  return createServiceRoleClient() as Db
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function dataEngineRequestHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function assertBatchId(value: string) {
  if (!text(value) || text(value).length > 200) throw new ApiDomainError("INVALID_REQUEST", "The DataEngine batch identifier is invalid.", false, "send_valid_batch_id", 400)
}

function isSameOrSubdomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`)
}

function hostFromUrl(value: string | null | undefined) {
  try {
    return normalizeDataEngineDomain(new URL(value || "").hostname)
  } catch {
    return null
  }
}

function dataEngineIdentityKey(lead: DataEngineLead) {
  if (lead.place_id) return `place:${lead.place_id.trim()}`
  const nameAddress = dataEngineNameAddressKey(lead.name, lead.address)
  return nameAddress ? `name_address:${nameAddress}` : null
}

async function captureOfficialSiteScreenshot(lead: DataEngineLead, domain: string | null): Promise<WebsiteImageFile> {
  if (!lead.official_website_url) throw new Error("An official website is required for a screenshot fallback.")
  const officialUrl = await assertSafeOfficialWebsiteUrl(lead.official_website_url, domain)
  let chromium: typeof import("playwright-core").chromium
  let executablePath = process.env.RESERVEVIA_SCREENSHOT_EXECUTABLE_PATH || ""
  try {
    chromium = (await import("playwright-core")).chromium
    if (!executablePath) {
      const bundled = (await import("@sparticuz/chromium")).default
      executablePath = await bundled.executablePath()
    }
  } catch {
    throw new Error("SCREENSHOT_RUNTIME_UNAVAILABLE: production Chromium is not configured.")
  }
  if (!executablePath) throw new Error("SCREENSHOT_RUNTIME_UNAVAILABLE: production Chromium executable is unavailable.")
  let browser: Awaited<ReturnType<typeof chromium.launch>>
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
    })
  } catch {
    throw new Error("SCREENSHOT_RUNTIME_UNAVAILABLE: production Chromium could not be launched.")
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 }, deviceScaleFactor: 1 })
    await page.route("**/*", async (route) => {
      const requestUrl = route.request().url()
      if (/^(data|blob|about):/i.test(requestUrl)) return route.continue()
      try {
        await assertSafeOfficialWebsiteUrl(requestUrl, domain)
        return route.continue()
      } catch {
        return route.abort()
      }
    })
    const response = await page.goto(officialUrl.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 })
    if (!response || response.status() < 200 || response.status() >= 400) throw new Error(`The official website returned ${response?.status() || "no response"}.`)
    await page.waitForTimeout(2_000)
    const finalHost = hostFromUrl(page.url())
    if (domain && finalHost && !isSameOrSubdomain(finalHost, domain)) throw new Error("The official website redirected to another domain.")
    const pageState = await page.evaluate(() => {
      const body = document.body?.innerText?.replace(/\s+/g, " ").trim() || ""
      const title = document.title?.trim() || ""
      const source = `${title} ${body}`.toLowerCase()
      const challenge = /(captcha|cloudflare|access denied|verify you are human|robot check|security check|page not found|internal server error)/i.test(source)
      return { bodyLength: body.length, challenge, hasHeading: Boolean(document.querySelector("h1,h2")), hasImage: Boolean(document.querySelector("img")) }
    })
    if (pageState.challenge || pageState.bodyLength < 80 || (!pageState.hasHeading && !pageState.hasImage)) throw new Error("The screenshot page appears empty, blocked, or unusable.")
    const bytes = await page.screenshot({ type: "png", animations: "disabled" })
    return { bytes: new Uint8Array(bytes), contentType: "image/png", extension: "png" }
  } finally {
    await browser.close()
  }
}

async function imageIsBannerQuality(image: WebsiteImageFile) {
  const metadata = await sharp(image.bytes).metadata()
  const width = metadata.width || 0
  const height = metadata.height || 0
  const ratio = height ? width / height : 0
  const stats = await sharp(image.bytes).stats()
  const contrast = stats.channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(stats.channels.length, 1)
  return { width, height, valid: width >= MIN_BANNER_WIDTH && width <= MAX_BANNER_WIDTH && height >= MIN_BANNER_HEIGHT && ratio >= MIN_BANNER_RATIO && ratio <= MAX_BANNER_RATIO && contrast >= 3 }
}

async function stageBannerForLead(service: Db, batchId: string, leadId: string, lead: DataEngineLead, preferredUrl?: string | null) {
  const domain = normalizeDataEngineDomain(lead.official_domain || hostFromUrl(lead.official_website_url))
  const candidates = Array.from(new Set([
    preferredUrl,
    lead.banner?.url,
    lead.website_data.hero_image_url,
  ].filter((value): value is string => Boolean(value))))
  let selected: { image: WebsiteImageFile; sourceType: string; sourceUrl: string | null; dimensions: { width: number; height: number } } | null = null

  for (const candidate of candidates) {
    const host = hostFromUrl(candidate)
    if (host && domain && !isSameOrSubdomain(host, domain)) continue
    try {
      const image = await fetchVerifiedWebsiteImage(candidate, { expectedDomain: domain })
      const dimensions = await imageIsBannerQuality(image)
      if (!dimensions.valid) continue
      selected = { image, sourceType: lead.banner?.source_type || (candidate === lead.website_data.hero_image_url ? "official_hero" : "official_image"), sourceUrl: candidate, dimensions }
      break
    } catch {
      // One unusable image must not prevent the importer from trying the next
      // official candidate or producing the deterministic fallback below.
    }
  }

  if (!selected && lead.official_website_url) {
    try {
      const discovered = await importRestaurantFromWebsite(lead.official_website_url, { maxDiscoveryPages: 3 })
      for (const candidate of discovered.bannerCandidates) {
        try {
          const image = await fetchVerifiedWebsiteImage(candidate.url, { expectedDomain: domain })
          const dimensions = await imageIsBannerQuality(image)
          if (!dimensions.valid) continue
          selected = { image, sourceType: "official_image", sourceUrl: candidate.url, dimensions }
          break
        } catch {
          // Continue through bounded website candidates.
        }
      }
    } catch {
      // The fallback is still useful when the official site is unavailable.
    }
  }

  if (!selected) {
    const image = await captureOfficialSiteScreenshot(lead, domain)
    const dimensions = await imageIsBannerQuality(image)
    if (!dimensions.valid) throw new Error("The official website screenshot did not meet banner quality requirements.")
    selected = { image, sourceType: "homepage_screenshot", sourceUrl: lead.official_website_url || null, dimensions }
  }

  const path = `${batchId}/${leadId}/banner.${selected.image.extension}`
  await uploadVerifiedWebsiteImage({ service, bucket: DATAENGINE_ASSET_BUCKET, path, image: selected.image, upsert: true })
  const signed = await service.storage.from(DATAENGINE_ASSET_BUCKET).createSignedUrl(path, 60 * 60)
  if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message || "The staged banner preview could not be created.")
  const { error } = await service.from("dataengine_import_leads").update({
    staged_banner_path: path,
    staged_banner_source_type: selected.sourceType,
    staged_banner_source_url: selected.sourceUrl,
    staged_banner_content_type: selected.image.contentType,
    staged_banner_width: selected.dimensions.width,
    staged_banner_height: selected.dimensions.height,
    banner_status: "staged",
    banner_error: null,
    official_website_verified_at: new Date().toISOString(),
  }).eq("id", leadId).eq("batch_id", batchId)
  if (error) throw new Error(error.message)
  return { path, previewUrl: signed.data.signedUrl, sourceType: selected.sourceType, sourceUrl: selected.sourceUrl, width: selected.dimensions.width, height: selected.dimensions.height, verifiedWebsite: true }
}

async function findExistingRestaurant(service: Db, lead: DataEngineLead) {
  const domain = normalizeDataEngineDomain(lead.official_domain || hostFromUrl(lead.official_website_url))
  const placeId = text(lead.place_id)
  if (placeId) {
    const { data: previous, error } = await service.from("dataengine_import_leads").select("id, restaurant_id, name, batch_id").eq("source_place_id", placeId).neq("review_status", "rejected").order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (error) throw new Error(error.message)
    if (previous) return { restaurantId: previous.restaurant_id as string | null, previousLeadId: previous.id as string, reason: "The DataEngine place identifier was imported before." }
  }
  if (domain) {
    const { data: profiles, error } = await service.from("restaurant_claim_profiles").select("restaurant_id, official_domain, ownership_status").eq("official_domain", domain).limit(20)
    if (error) throw new Error(error.message)
    if ((profiles || []).length === 1) return { restaurantId: profiles![0].restaurant_id as string, previousLeadId: null, reason: "The official domain already belongs to a ReserveVia restaurant." }
    if ((profiles || []).length > 1) return { restaurantId: null, previousLeadId: null, reason: "The official domain belongs to multiple ReserveVia restaurants." }
  }
  const targetKey = dataEngineNameAddressKey(lead.name, lead.address)
  if (targetKey) {
    const { data: restaurants, error } = await service.from("restaurants").select("id, name, address_line1, address_locality, location").ilike("name", lead.name).limit(20)
    if (error) throw new Error(error.message)
    const match = (restaurants || []).find((restaurant: any) => [restaurant.address_line1, restaurant.address_locality, restaurant.location].some((address) => dataEngineNameAddressKey(restaurant.name, address) === targetKey))
    if (match) return { restaurantId: match.id as string, previousLeadId: null, reason: "The normalized restaurant name and address already exist." }
  }
  return null
}

async function refreshBatchCounters(service: Db, batchId: string) {
  const { data: leads, error } = await service.from("dataengine_import_leads").select("readiness_status, review_status, publish_status").eq("batch_id", batchId)
  if (error) throw new Error(error.message)
  const rows = leads || []
  const counts = {
    total_leads: rows.length,
    ready_leads: rows.filter((row: any) => row.readiness_status === "ready").length,
    needs_data_leads: rows.filter((row: any) => row.readiness_status === "needs_data").length,
    conflict_leads: rows.filter((row: any) => ["needs_review", "duplicate"].includes(row.readiness_status)).length,
    approved_leads: rows.filter((row: any) => ["approved", "published"].includes(row.review_status)).length,
    published_leads: rows.filter((row: any) => row.review_status === "published").length,
    rejected_leads: rows.filter((row: any) => row.review_status === "rejected" || row.readiness_status === "rejected").length,
  }
  const pending = rows.some((row: any) => row.review_status === "pending")
  const publishing = rows.some((row: any) => row.publish_status === "publishing")
  const nextStatus = counts.published_leads === rows.length && rows.length > 0
    ? "published"
    : rows.some((row: any) => row.publish_status === "failed" || row.banner_status === "failed")
      ? "recovery_required"
    : publishing
      ? "publishing"
      : counts.published_leads > 0
        ? "partially_published"
        : pending
          ? "needs_review"
          : "rejected"
  const { data: batch, error: updateError } = await service.from("dataengine_import_batches").update({ ...counts, status: nextStatus, reviewed_at: counts.approved_leads || counts.rejected_leads ? new Date().toISOString() : null, published_at: nextStatus === "published" ? new Date().toISOString() : null, summary: counts }).eq("id", batchId).select("*").single()
  if (updateError) throw new Error(updateError.message)
  return batch
}

async function releaseBatchIdentityReservations(service: Db, batchId: string) {
  const { data: rows, error } = await service.from("dataengine_import_leads").select("id, restaurant_id").eq("batch_id", batchId)
  if (error) throw new Error(error.message)
  for (const row of rows || []) {
    if (!row.restaurant_id) {
      const { error: releaseError } = await service.rpc("release_dataengine_import_identity", { target_lead_id: row.id } as any)
      if (releaseError) throw new Error(releaseError.message)
    }
  }
}

async function selectIngestResponse(service: Db, batchId: string) {
  const [{ data: batch, error: batchError }, { data: leads, error: leadsError }] = await Promise.all([
    service.from("dataengine_import_batches").select("id, external_batch_id, contract_version, source_run_id, source_export_id, source_scoring_version, status, total_leads, ready_leads, needs_data_leads, conflict_leads, approved_leads, published_leads, rejected_leads, summary, created_at, updated_at, reviewed_at, published_at, last_error, ingest_phase, ingest_attempt_count").eq("id", batchId).maybeSingle(),
    service.from("dataengine_import_leads").select("id, external_candidate_id, readiness_status, review_status, restaurant_id, duplicate_restaurant_id, conflict_reason, staged_banner_source_type, staged_banner_width, staged_banner_height, publish_status, publish_phase, publish_attempt_count, banner_status, claimed_conflict").eq("batch_id", batchId).order("created_at", { ascending: true }),
  ])
  if (batchError) throw new Error(batchError.message)
  if (leadsError) throw new Error(leadsError.message)
  return { batch, leads: leads || [] }
}

export async function ingestDataEngineBatch(input: unknown, apiClientId: string, requestHash: string) {
  const parsed = dataEngineBatchSchema.safeParse(input)
  if (!parsed.success) throw new ApiDomainError("INVALID_REQUEST", "The DataEngine batch contract is invalid.", false, "fix_contract_payload", 400)
  const batch = parsed.data
  assertBatchId(batch.batch_id)
  if (!UUID_PATTERN.test(apiClientId)) throw new ApiDomainError("UNAUTHORIZED_CLIENT", "The DataEngine client is invalid.", false, "authenticate_client", 401)
  if (new Set(batch.leads.map((lead) => lead.candidate_id)).size !== batch.leads.length) {
    throw new ApiDomainError("INVALID_REQUEST", "A DataEngine batch cannot contain duplicate candidate_id values.", false, "deduplicate_candidates", 400)
  }

  const service = db()
  const existing = await service.from("dataengine_import_batches").select("id, request_hash, status").eq("external_batch_id", batch.batch_id).maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data?.request_hash && existing.data.request_hash !== requestHash) {
    throw new ApiDomainError("IDEMPOTENCY_CONFLICT", "This DataEngine batch identifier was already used for different data.", false, "use_new_batch_id", 409)
  }
  if (existing.data && ["needs_review", "partially_approved", "approved", "publishing", "partially_published", "rejected", "published"].includes(existing.data.status)) {
    return { replayed: true, ...(await selectIngestResponse(service, existing.data.id)) }
  }

  const leaseToken = randomUUID()
  const { data: claimResult, error: claimError } = await service.rpc("claim_dataengine_import_batch", {
    target_external_batch_id: batch.batch_id,
    target_contract_version: DATAENGINE_CONTRACT_VERSION,
    target_api_client_id: apiClientId,
    target_request_hash: requestHash,
    target_total_leads: batch.leads.length,
    target_lease_token: leaseToken,
  } as any)
  if (claimError) {
    if (claimError.message.includes("IDEMPOTENCY_CONFLICT")) throw new ApiDomainError("IDEMPOTENCY_CONFLICT", "This DataEngine batch identifier was already used for different data.", false, "use_new_batch_id", 409)
    throw new Error(claimError.message)
  }
  const claim = Array.isArray(claimResult) ? claimResult[0] : claimResult
  if (!claim?.lease_acquired) {
    const claimedBatchId = claim?.batch_id || existing.data?.id
    if (!claimedBatchId) throw new Error("DataEngine ingest did not return a batch identifier.")
    const response = await selectIngestResponse(service, claimedBatchId)
    return { replayed: Boolean(claim?.replayable), ...response }
  }

  const batchId = claim.batch_id as string
  try {
    const { error: metadataError } = await service.from("dataengine_import_batches").update({
      source_run_id: batch.source_run_id || null,
      source_export_id: batch.source_export_id || null,
      source_scoring_version: batch.scoring_version || null,
      summary: { generatedAt: batch.generated_at || null },
      ingest_phase: "leads",
    }).eq("id", batchId).eq("ingest_lease_token", leaseToken)
    if (metadataError) throw new Error(metadataError.message)

    const rows = []
    for (const lead of batch.leads) {
      const existingMatch = await findExistingRestaurant(service, lead)
      const derived = deriveDataEngineReadiness(lead, false)
      rows.push({
        batch_id: batchId,
        external_candidate_id: lead.candidate_id,
        identity_key: dataEngineIdentityKey(lead),
        source_place_id: lead.place_id || null,
        name: lead.name,
        city: lead.city || null,
        address: lead.address || null,
        official_website_url: lead.official_website_url || null,
        official_domain: derived.officialDomain,
        source_candidate_status: lead.candidate_status,
        source_classification: lead.classification || null,
        fit_score: lead.fit_score ?? null,
        data_confidence: lead.data_confidence ?? null,
        source_scoring_version: lead.scoring_version || batch.scoring_version || null,
        enrichment_status: lead.enrichment_status || null,
        business_match: lead.business_match || null,
        readiness_status: existingMatch ? "duplicate" : derived.status,
        review_status: derived.status === "rejected" ? "rejected" : "pending",
        restaurant_id: existingMatch?.restaurantId || null,
        duplicate_restaurant_id: existingMatch?.restaurantId || null,
        conflict_reason: existingMatch?.reason || derived.reason,
        business_contact_email: derived.businessEmail,
        normalized_business_contact_email: derived.businessEmail,
        source_payload: lead,
      })
    }
    const { error: leadError } = await service.from("dataengine_import_leads").upsert(rows, { onConflict: "batch_id,external_candidate_id", ignoreDuplicates: true })
    if (leadError) throw new Error(leadError.message)

    const { data: storedLeads, error: storedLeadError } = await service.from("dataengine_import_leads").select("id, external_candidate_id, identity_key, restaurant_id, readiness_status, review_status, conflict_reason, staged_banner_path, banner_status, official_website_verified_at").eq("batch_id", batchId).order("created_at", { ascending: true })
    if (storedLeadError) throw new Error(storedLeadError.message)
    const evidenceRows = (storedLeads || []).flatMap((row: any) => {
      const lead = batch.leads.find((item) => item.candidate_id === row.external_candidate_id)
      return (lead?.evidence || []).map((evidence) => ({ lead_id: row.id, field: evidence.field, value: evidence.value, source_url: evidence.source_url || "", source_type: evidence.source_type || null, extraction_method: evidence.extraction_method || null, confidence: evidence.confidence || null, business_match: evidence.business_match || null, scope: evidence.scope || null, observed_at: evidence.observed_at || null }))
    })
    if (evidenceRows.length) {
      const { error: evidenceError } = await service.from("dataengine_import_evidence").upsert(evidenceRows, { onConflict: "lead_id,field,value,source_url", ignoreDuplicates: true })
      if (evidenceError) throw new Error(evidenceError.message)
    }

    for (const row of storedLeads || []) {
      const lead = batch.leads.find((item) => item.candidate_id === row.external_candidate_id)
      if (!lead || !row.identity_key) continue
      const { data: identityResult, error: identityError } = await service.rpc("claim_dataengine_import_identity", { target_identity_key: row.identity_key, target_lead_id: row.id, target_restaurant_id: row.restaurant_id || null } as any)
      if (identityError) throw new Error(identityError.message)
      const identity = Array.isArray(identityResult) ? identityResult[0] : identityResult
      const identityOwner = identity?.is_owner !== false
      const matchedExisting = Boolean(row.restaurant_id)
      let claimedConflict = false
      if (row.restaurant_id) {
        const { data: claimProfile, error: claimProfileError } = await service.from("restaurant_claim_profiles").select("ownership_status").eq("restaurant_id", row.restaurant_id).maybeSingle()
        if (claimProfileError) throw new Error(claimProfileError.message)
        claimedConflict = claimProfile?.ownership_status === "claimed"
      }
      const reason = !identityOwner
        ? identity.restaurant_id ? "The normalized DataEngine identity is already linked to a ReserveVia restaurant." : "The normalized DataEngine identity is already awaiting review in another batch."
        : claimedConflict ? "Existing restaurant is claimed. Store the DataEngine snapshot as a private suggestion only." : matchedExisting ? "The DataEngine candidate matches an existing ReserveVia restaurant." : null
      const preexistingConflict = row.readiness_status === "duplicate" && !row.restaurant_id && Boolean(row.conflict_reason)
      const derived = deriveDataEngineReadiness(lead, row.banner_status === "staged" && Boolean(row.staged_banner_path), { verifiedWebsite: Boolean(row.official_website_verified_at), hasIdentityConflict: !identityOwner || matchedExisting || preexistingConflict })
      const { error: readinessError } = await service.from("dataengine_import_leads").update({
        identity_status: !identityOwner ? "duplicate" : matchedExisting ? "linked" : "owner",
        identity_claimed_at: identityOwner ? new Date().toISOString() : null,
        readiness_status: !identityOwner || matchedExisting || preexistingConflict ? "duplicate" : derived.status,
        duplicate_restaurant_id: !identityOwner ? identity.restaurant_id || null : row.restaurant_id || null,
        conflict_reason: reason || (preexistingConflict ? row.conflict_reason : derived.reason),
        claimed_conflict: claimedConflict,
        claimed_update_suggestion: claimedConflict ? lead : {},
        business_contact_email: derived.businessEmail,
        normalized_business_contact_email: derived.businessEmail,
      }).eq("id", row.id)
      if (readinessError) throw new Error(readinessError.message)
    }

    const finalBatch = await refreshBatchCounters(service, batchId)
    const { error: completeError } = await service.from("dataengine_import_batches").update({ status: finalBatch.status === "rejected" ? "rejected" : "needs_review", ingest_phase: "completed", ingest_completed_at: new Date().toISOString(), ingest_lease_token: null, ingest_lease_until: null, last_ingest_error: null, last_error: null }).eq("id", batchId).eq("ingest_lease_token", leaseToken)
    if (completeError) throw new Error(completeError.message)
    return { replayed: false, ...(await selectIngestResponse(service, batchId)) }
  } catch (error) {
    await releaseBatchIdentityReservations(service, batchId).catch((releaseError) => console.error("DataEngine identity recovery failed:", releaseError))
    await service.from("dataengine_import_batches").update({ status: "failed", ingest_phase: "failed", ingest_lease_token: null, ingest_lease_until: null, last_ingest_error: error instanceof Error ? error.message.slice(0, 2000) : "DataEngine ingest failed.", last_error: error instanceof Error ? error.message.slice(0, 2000) : "DataEngine ingest failed." }).eq("id", batchId).eq("ingest_lease_token", leaseToken)
    throw error
  }
}

export async function listDataEngineImportBatches() {
  const service = db()
  const { data, error } = await service.from("dataengine_import_batches").select("id, external_batch_id, contract_version, source_run_id, source_export_id, source_scoring_version, status, total_leads, ready_leads, needs_data_leads, conflict_leads, approved_leads, published_leads, rejected_leads, summary, created_at, updated_at, reviewed_at, published_at, last_error, last_ingest_error, ingest_phase, ingest_attempt_count").order("created_at", { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return data || []
}

export async function getDataEngineImportBatch(batchId: string) {
  if (!UUID_PATTERN.test(batchId)) return null
  const service = db()
  const [{ data: batch, error: batchError }, { data: leads, error: leadsError }] = await Promise.all([
    service.from("dataengine_import_batches").select("*").eq("id", batchId).maybeSingle(),
    service.from("dataengine_import_leads").select("id, batch_id, external_candidate_id, source_place_id, name, city, address, official_website_url, official_domain, source_candidate_status, source_classification, fit_score, data_confidence, source_scoring_version, enrichment_status, business_match, readiness_status, review_status, restaurant_id, duplicate_restaurant_id, conflict_reason, business_contact_email, staged_banner_path, staged_banner_source_type, staged_banner_source_url, staged_banner_content_type, staged_banner_width, staged_banner_height, banner_status, banner_attempt_count, banner_error, official_website_verified_at, publish_status, publish_phase, publish_attempt_count, publish_error, claimed_conflict, claimed_update_suggestion, public_banner_path, created_at, updated_at, reviewed_at, published_at").eq("batch_id", batchId).order("created_at", { ascending: true }),
  ])
  if (batchError) throw new Error(batchError.message)
  if (leadsError) throw new Error(leadsError.message)
  if (!batch) return null
  const leadIds = (leads || []).map((lead: any) => lead.id)
  const { data: evidence, error: evidenceError } = leadIds.length ? await service.from("dataengine_import_evidence").select("lead_id, field, value, source_url, source_type, extraction_method, confidence, business_match, scope, observed_at").in("lead_id", leadIds) : { data: [], error: null }
  if (evidenceError) throw new Error(evidenceError.message)
  const evidenceByLead = new Map<string, any[]>()
  for (const item of evidence || []) evidenceByLead.set(item.lead_id, [...(evidenceByLead.get(item.lead_id) || []), item])
  const restaurantIds = Array.from(new Set((leads || []).map((lead: any) => lead.restaurant_id).filter(Boolean)))
  const { data: claimProfiles, error: claimProfilesError } = restaurantIds.length
    ? await service.from("restaurant_claim_profiles").select("restaurant_id, business_email_delivery_status, business_email_last_error, ownership_status").in("restaurant_id", restaurantIds)
    : { data: [], error: null }
  if (claimProfilesError) throw new Error(claimProfilesError.message)
  const claimProfileByRestaurant = new Map((claimProfiles || []).map((profile: any) => [profile.restaurant_id, profile]))
  const { data: deliveryEvents, error: deliveryEventsError } = restaurantIds.length
    ? await service.from("email_delivery_events").select("id, restaurant_id, status, attempt_count, last_error, provider_message_id, updated_at").eq("kind", "unclaimed_business_reservation").in("restaurant_id", restaurantIds).order("created_at", { ascending: false })
    : { data: [], error: null }
  if (deliveryEventsError) throw new Error(deliveryEventsError.message)
  const deliveryByRestaurant = new Map<string, any>()
  for (const event of deliveryEvents || []) if (!deliveryByRestaurant.has(event.restaurant_id)) deliveryByRestaurant.set(event.restaurant_id, event)
  const previews = await Promise.all((leads || []).map(async (lead: any) => {
    let previewUrl: string | null = null
    if (lead.staged_banner_path) {
      const signed = await service.storage.from(DATAENGINE_ASSET_BUCKET).createSignedUrl(lead.staged_banner_path, 60 * 15)
      previewUrl = signed.data?.signedUrl || null
    }
    const claimProfile = lead.restaurant_id ? claimProfileByRestaurant.get(lead.restaurant_id) : null
    const deliveryEvent = lead.restaurant_id ? deliveryByRestaurant.get(lead.restaurant_id) : null
    return { ...lead, banner_preview_url: previewUrl, evidence: evidenceByLead.get(lead.id) || [], business_email_delivery_status: deliveryEvent?.status || claimProfile?.business_email_delivery_status || null, business_email_last_error: deliveryEvent?.last_error || claimProfile?.business_email_last_error || null, business_email_delivery_event_id: deliveryEvent?.id || null, business_email_attempt_count: deliveryEvent?.attempt_count || 0 }
  }))
  return { batch, leads: previews }
}

export async function prepareDataEngineLeadBanner(leadId: string) {
  if (!UUID_PATTERN.test(leadId)) throw new Error("Invalid DataEngine lead identifier.")
  const service = db()
  const { data: row, error } = await service.from("dataengine_import_leads").select("id, batch_id, source_payload, readiness_status, restaurant_id, duplicate_restaurant_id, conflict_reason, staged_banner_path, staged_banner_source_type, staged_banner_source_url, staged_banner_width, staged_banner_height, banner_status, banner_attempt_count, official_website_verified_at").eq("id", leadId).maybeSingle()
  if (error || !row) throw new Error(error?.message || "DataEngine lead not found.")
  if (row.staged_banner_path) {
    const signed = await service.storage.from(DATAENGINE_ASSET_BUCKET).createSignedUrl(row.staged_banner_path, 60 * 60)
    if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message || "The staged banner preview could not be created.")
    const lead = dataEngineLeadFromPayload(row.source_payload)
    const duplicateConflict = row.readiness_status === "duplicate" && !row.restaurant_id
    const derived = deriveDataEngineReadiness(lead, true, { verifiedWebsite: Boolean(row.official_website_verified_at), hasIdentityConflict: duplicateConflict })
    const readinessStatus = duplicateConflict ? "duplicate" : derived.status
    const { error: readinessError } = await service.from("dataengine_import_leads").update({ readiness_status: readinessStatus, conflict_reason: duplicateConflict ? row.conflict_reason : derived.reason, business_contact_email: derived.businessEmail, normalized_business_contact_email: derived.businessEmail }).eq("id", row.id)
    if (readinessError) throw new Error(readinessError.message)
    await refreshBatchCounters(service, row.batch_id)
    return { success: true as const, previewUrl: signed.data.signedUrl, sourceType: row.staged_banner_source_type, sourceUrl: row.staged_banner_source_url, width: row.staged_banner_width, height: row.staged_banner_height, readinessStatus }
  }
  const lead = dataEngineLeadFromPayload(row.source_payload)
  let staged: Awaited<ReturnType<typeof stageBannerForLead>>
  try {
    staged = await stageBannerForLead(service, row.batch_id, row.id, lead)
  } catch (error) {
    const message = error instanceof Error ? error.message : "The banner could not be staged."
    await service.from("dataengine_import_leads").update({ banner_status: "failed", banner_attempt_count: (row.banner_attempt_count || 0) + 1, banner_error: message.slice(0, 2000), readiness_status: "needs_data", conflict_reason: message.slice(0, 2000) }).eq("id", row.id)
    await refreshBatchCounters(service, row.batch_id)
    throw error
  }
  const duplicateConflict = row.readiness_status === "duplicate" && !row.restaurant_id
  const derived = deriveDataEngineReadiness(lead, true, { verifiedWebsite: staged.verifiedWebsite, hasIdentityConflict: duplicateConflict })
  const readinessStatus = duplicateConflict ? "duplicate" : derived.status
  const readinessReason = duplicateConflict ? row.conflict_reason : derived.reason
  const { error: readinessError } = await service.from("dataengine_import_leads").update({ readiness_status: readinessStatus, conflict_reason: readinessReason, business_contact_email: derived.businessEmail, normalized_business_contact_email: derived.businessEmail }).eq("id", row.id)
  if (readinessError) throw new Error(readinessError.message)
  await refreshBatchCounters(service, row.batch_id)
  return { success: true as const, ...staged, readinessStatus }
}

function dataEngineLeadFromPayload(payload: unknown) {
  const parsed = dataEngineLeadSchemaFromPayload(payload)
  return parsed
}

function dataEngineLeadSchemaFromPayload(payload: unknown) {
  const result = dataEngineLeadSchema.safeParse(payload)
  if (!result.success) throw new Error("Stored DataEngine lead payload is invalid.")
  return result.data as DataEngineLead
}

async function publishStagedBanner(service: Db, lead: any, workspaceId: string, restaurantId: string) {
  if (!lead.staged_banner_path) throw new Error("A stored banner is required before publishing.")
  const downloaded = await service.storage.from(DATAENGINE_ASSET_BUCKET).download(lead.staged_banner_path)
  if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message || "The staged banner could not be read.")
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
  const image: WebsiteImageFile = { bytes, contentType: lead.staged_banner_content_type || "image/png", extension: (lead.staged_banner_path.split(".").pop() || "png") as WebsiteImageFile["extension"] }
  const path = lead.public_banner_path || `${workspaceId}/${restaurantId}/primary/dataengine-${lead.id}.${image.extension}`
  await uploadVerifiedWebsiteImage({ service, bucket: "restaurant-assets", path, image, upsert: true })
  const publicUrl = service.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl
  if (!publicUrl) throw new Error("The published banner URL could not be created.")
  const { error } = await service.from("dataengine_import_leads").update({ public_banner_path: path, public_banner_url: publicUrl, public_banner_published_at: new Date().toISOString(), publish_phase: "banner_published" }).eq("id", lead.id)
  if (error) throw new Error(error.message)
  return publicUrl
}

function publicProfileFromLead(lead: DataEngineLead) {
  const website = lead.website_data
  if (!website.site_name?.trim()) throw new Error("An official website name is required before public publishing.")
  return {
    name: website.site_name.trim(),
    official_website_url: lead.official_website_url || website.canonical_url || null,
    social_links: { website: lead.official_website_url || website.canonical_url || null },
    description: website.description || null,
    cuisine: website.cuisine.join(", ") || null,
    hours: website.opening_hours.join(" · ") || null,
    location: website.address || null,
    phone: website.phones[0] || null,
    menu_url: website.menu_urls[0] || null,
    location_url: null,
    events_url: null,
  }
}

async function markDataEnginePublishFailure(service: Db, leadId: string, leaseToken: string, error: unknown) {
  const message = error instanceof Error ? error.message : "DataEngine publication failed."
  await service.from("dataengine_import_leads").update({ publish_status: "failed", publish_phase: "failed", publish_error: message.slice(0, 2000), publish_lease_token: null, publish_lease_until: null }).eq("id", leadId).eq("publish_lease_token", leaseToken)
  return message
}

async function publishSingleDataEngineLead(service: Db, row: any, batchId: string) {
  const leaseToken = randomUUID()
  const { data: claimResult, error: claimError } = await service.rpc("claim_dataengine_lead_publish", { target_lead_id: row.id, target_lease_token: leaseToken } as any)
  if (claimError) throw new Error(claimError.message)
  const claim = Array.isArray(claimResult) ? claimResult[0] : claimResult
  if (!claim?.claimed) return { id: row.id, status: claim?.current_status || row.publish_status || "blocked", restaurantId: row.restaurant_id || null }

  try {
    const source = dataEngineLeadFromPayload(row.source_payload)
    const profile = publicProfileFromLead(source)
    const email = getFirstVerifiedBusinessEmail(source)
    if (!email) throw new Error("Verified first-party business email is required.")
    if (row.readiness_status !== "ready" || row.banner_status !== "staged" || !row.official_website_verified_at || !row.staged_banner_path) {
      throw new Error("The lead is not in a publishable readiness state.")
    }

    if (row.duplicate_restaurant_id && !row.restaurant_id) {
      await service.from("dataengine_import_leads").update({ publish_status: "blocked", publish_phase: "duplicate", conflict_reason: row.conflict_reason || "This candidate matches an existing restaurant.", publish_lease_token: null, publish_lease_until: null }).eq("id", row.id).eq("publish_lease_token", leaseToken)
      return { id: row.id, status: "duplicate", restaurantId: row.duplicate_restaurant_id }
    }
    if (row.restaurant_id) {
      const { data: claimProfile, error: profileError } = await service.from("restaurant_claim_profiles").select("ownership_status, source, business_contact_email, official_domain").eq("restaurant_id", row.restaurant_id).maybeSingle()
      if (profileError) throw new Error(profileError.message)
      if (claimProfile?.ownership_status === "claimed") {
        const { error } = await service.from("dataengine_import_leads").update({ claimed_conflict: true, claimed_update_suggestion: source, publish_status: "blocked", publish_phase: "claimed_conflict", conflict_reason: "Existing restaurant is claimed. DataEngine snapshot was stored as a private suggestion only.", publish_lease_token: null, publish_lease_until: null }).eq("id", row.id).eq("publish_lease_token", leaseToken)
        if (error) throw new Error(error.message)
        return { id: row.id, status: "claimed_conflict", restaurantId: row.restaurant_id }
      }
      if (!row.workspace_id) {
        await service.from("dataengine_import_leads").update({ publish_status: "blocked", publish_phase: "duplicate", conflict_reason: row.conflict_reason || "This candidate matches an existing unclaimed restaurant.", publish_lease_token: null, publish_lease_until: null }).eq("id", row.id).eq("publish_lease_token", leaseToken)
        return { id: row.id, status: "duplicate", restaurantId: row.restaurant_id }
      }
    }

    const { data: provisionedResult, error: provisionError } = await service.rpc("provision_dataengine_lead_tenant", {
      target_lead_id: row.id,
      target_batch_id: batchId,
      target_restaurant_name: profile.name,
      target_business_contact_email: email,
      target_official_website_url: profile.official_website_url,
      target_official_domain: row.official_domain,
      target_profile: profile,
    } as any)
    if (provisionError) throw new Error(provisionError.message)
    const provisioned = Array.isArray(provisionedResult) ? provisionedResult[0] : provisionedResult
    if (!provisioned?.restaurant_id || !provisioned.workspace_id) throw new Error("DataEngine tenant provisioning returned no identifiers.")
    const fresh = { ...row, restaurant_id: provisioned.restaurant_id, workspace_id: provisioned.workspace_id, restaurant_slug: provisioned.restaurant_slug }
    const publicBannerUrl = row.public_banner_url || await publishStagedBanner(service, fresh, provisioned.workspace_id, provisioned.restaurant_id)
    const { data: finalizedResult, error: finalizeError } = await service.rpc("finalize_dataengine_lead_publication", {
      target_lead_id: row.id,
      target_restaurant_id: provisioned.restaurant_id,
      target_public_banner_url: publicBannerUrl,
      target_profile: profile,
    } as any)
    if (finalizeError) throw new Error(finalizeError.message)
    const finalized = Array.isArray(finalizedResult) ? finalizedResult[0] : finalizedResult
    if (!finalized?.published) return { id: row.id, status: finalized?.final_status || "blocked", restaurantId: provisioned.restaurant_id }
    const publicUrl = await getRestaurantPublicUrl({ id: provisioned.restaurant_id, slug: provisioned.restaurant_slug, workspaceId: provisioned.workspace_id })
    return { id: row.id, status: "published", restaurantId: provisioned.restaurant_id, publicUrl }
  } catch (error) {
    const message = await markDataEnginePublishFailure(service, row.id, leaseToken, error)
    return { id: row.id, status: "failed", reason: message, restaurantId: row.restaurant_id || null }
  }
}

export async function retryDataEngineLeadPublish(leadId: string) {
  if (!UUID_PATTERN.test(leadId)) throw new Error("Invalid DataEngine lead identifier.")
  const service = db()
  const { data: row, error } = await service.from("dataengine_import_leads").select("*").eq("id", leadId).maybeSingle()
  if (error || !row) throw new Error(error?.message || "DataEngine lead not found.")
  if (!row.batch_id || !["failed", "publishing"].includes(row.publish_status)) throw new Error("This lead has no recoverable publication state.")
  const result = await publishSingleDataEngineLead(service, row, row.batch_id)
  await refreshBatchCounters(service, row.batch_id)
  return { success: true as const, result }
}

export async function overrideDataEngineLeadReadiness(input: { batchId: string; leadId: string; reason: string; actorUserId?: string | null }) {
  if (!UUID_PATTERN.test(input.batchId) || !UUID_PATTERN.test(input.leadId) || input.leadId.length === 0 || input.reason.trim().length < 3) throw new Error("A single lead and a reason are required for a manual override.")
  const service = db()
  const { data: row, error } = await service.from("dataengine_import_leads").select("id, batch_id, source_payload, readiness_status, staged_banner_path, banner_status, official_website_verified_at, duplicate_restaurant_id").eq("id", input.leadId).eq("batch_id", input.batchId).maybeSingle()
  if (error || !row) throw new Error(error?.message || "DataEngine lead not found.")
  if (row.duplicate_restaurant_id) throw new Error("Identity conflicts cannot be overridden automatically.")
  const source = dataEngineLeadFromPayload(row.source_payload)
  const derived = deriveDataEngineReadiness(source, row.banner_status === "staged" && Boolean(row.staged_banner_path), { verifiedWebsite: Boolean(row.official_website_verified_at), manualOverrideReason: input.reason })
  if (derived.status !== "ready") throw new Error(derived.reason || "The lead is still missing required data.")
  const { error: updateError } = await service.from("dataengine_import_leads").update({ readiness_status: "ready", conflict_reason: `Manual override: ${input.reason.trim()}`, manual_override_reason: input.reason.trim(), manual_override_by_user_id: input.actorUserId || null, manual_override_at: new Date().toISOString(), business_contact_email: derived.businessEmail, normalized_business_contact_email: derived.businessEmail }).eq("id", input.leadId).eq("batch_id", input.batchId)
  if (updateError) throw new Error(updateError.message)
  await refreshBatchCounters(service, input.batchId)
  return { success: true as const, leadId: input.leadId, readinessStatus: "ready" as const }
}

export async function reviewDataEngineLeads(input: { batchId: string; leadIds: string[]; decision: "approve" | "reject"; reason: string }) {
  if (!UUID_PATTERN.test(input.batchId) || input.leadIds.length < 1 || input.leadIds.length > MAX_BATCH_LEADS) throw new Error("The DataEngine review selection is invalid.")
  if (!input.reason?.trim() || input.reason.trim().length < 3 || input.reason.trim().length > 500) throw new Error("A review reason is required.")
  const uniqueLeadIds = Array.from(new Set(input.leadIds)).filter((id) => UUID_PATTERN.test(id))
  const service = db()
  const { data: rows, error } = await service.from("dataengine_import_leads").select("*").eq("batch_id", input.batchId).in("id", uniqueLeadIds).in("review_status", ["pending", "approved"])
  if (error) throw new Error(error.message)
  if (!rows?.length) throw new Error("No actionable DataEngine leads were selected.")
  const results: any[] = []
  for (const row of rows) {
    try {
      if (input.decision === "reject") {
        const { error: rejectError } = await service.from("dataengine_import_leads").update({ review_status: "rejected", readiness_status: "rejected", publish_status: "skipped", publish_phase: "rejected", conflict_reason: "Rejected in ReserveVia Platform Control.", reviewed_at: new Date().toISOString() }).eq("id", row.id)
        if (rejectError) throw new Error(rejectError.message)
        const { error: releaseError } = await service.rpc("release_dataengine_import_identity", { target_lead_id: row.id } as any)
        if (releaseError) throw new Error(releaseError.message)
        results.push({ id: row.id, status: "rejected" })
        continue
      }
      if (!row.staged_banner_path || row.banner_status !== "staged" || row.readiness_status !== "ready" || row.duplicate_restaurant_id || row.claimed_conflict) {
        results.push({ id: row.id, status: "blocked", reason: row.conflict_reason || "Lead requires strict readiness and conflict checks." })
        continue
      }
      results.push(await publishSingleDataEngineLead(service, row, input.batchId))
    } catch (rowError) {
      results.push({ id: row.id, status: "failed", reason: rowError instanceof Error ? rowError.message : "Lead operation failed." })
    }
  }
  const batch = await refreshBatchCounters(service, input.batchId)
  return { success: true as const, batch, results }
}
