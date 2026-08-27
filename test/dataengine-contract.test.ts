import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  dataEngineLeadSchema,
  dataEngineBatchSchema,
  deriveDataEngineReadiness,
  hasVerifiedBusinessEmail,
} from "../lib/dataengine-contract"
import { verifyResendWebhookSignature } from "../lib/email-delivery"
import { isEligibleOfficialDomain } from "../lib/claimable-restaurants"

function lead(overrides: Record<string, unknown> = {}) {
  return dataEngineLeadSchema.parse({
    candidate_id: "place:example-1",
    name: "Example Restaurant",
    official_website_url: "https://example.test",
    official_domain: "example.test",
    data_confidence: 90,
    enrichment_status: "enriched",
    business_match: "strong",
    website_data: { site_name: "Example Restaurant", emails: ["reservations@example.test"] },
    evidence: [
      { field: "business_contact_email", value: "reservations@example.test", source_url: "https://example.test/contact", confidence: "high", business_match: "strong", scope: "venue" },
      { field: "site_name", value: "Example Restaurant", source_url: "https://example.test/", confidence: "high", business_match: "strong", scope: "venue" },
    ],
    ...overrides,
  })
}

describe("DataEngine ReserveVia boundary", () => {
  it("accepts only official-domain, first-party email evidence", () => {
    expect(hasVerifiedBusinessEmail(lead())).toBe(true)
    expect(hasVerifiedBusinessEmail(lead({ website_data: { site_name: "Example Restaurant", emails: ["owner@gmail.com"] }, evidence: [{ field: "email", value: "owner@gmail.com", source_url: "https://example.test/contact", confidence: "high", business_match: "strong", scope: "venue" }] }))).toBe(true)
    expect(isEligibleOfficialDomain("owner@gmail.com", "example.test")).toBe(false)
    expect(isEligibleOfficialDomain("owner@example.test", "example.test")).toBe(true)
    expect(hasVerifiedBusinessEmail(lead({ website_data: { site_name: "Example Restaurant", emails: ["owner@gmail.com"] }, evidence: [{ field: "email", value: "owner@gmail.com", source_url: "https://maps.google.com/example", confidence: "high", scope: "venue" }] }))).toBe(false)
    expect(hasVerifiedBusinessEmail(lead({ evidence: [{ field: "email", value: "reservations@example.test", source_url: "https://brand.example.test/contact", confidence: "high", business_match: "strong", scope: "venue" }] }))).toBe(true)
    expect(hasVerifiedBusinessEmail(lead({ evidence: [{ field: "email", value: "reservations@example.test", source_url: "https://other.test/contact", confidence: "high", business_match: "strong", scope: "venue" }] }))).toBe(false)
  })

  it("keeps incomplete and ambiguous candidates private", () => {
    expect(deriveDataEngineReadiness(lead(), false).status).toBe("needs_data")
    expect(deriveDataEngineReadiness(lead(), true, { verifiedWebsite: true }).status).toBe("ready")
    expect(deriveDataEngineReadiness(lead({ business_match: "probable" }), true, { verifiedWebsite: true }).status).toBe("needs_review")
    expect(deriveDataEngineReadiness(lead({ data_confidence: 79 }), true, { verifiedWebsite: true }).status).toBe("needs_review")
    expect(deriveDataEngineReadiness(lead({ business_match: "probable", data_confidence: 79 }), true, { verifiedWebsite: true, manualOverrideReason: "Reviewed against official contact page." }).status).toBe("ready")
    expect(deriveDataEngineReadiness(lead({ website_data: { emails: ["reservations@example.test"] }, evidence: [{ field: "business_contact_email", value: "reservations@example.test", source_url: "https://example.test/contact", confidence: "high", business_match: "strong", scope: "venue" }] }), true, { verifiedWebsite: true }).status).toBe("needs_data")
  })

  it("rejects duplicate candidates at request validation", () => {
    const result = dataEngineBatchSchema.safeParse({ contract_version: "reservevia.dataengine.leads.v1", batch_id: "batch-1", leads: [lead(), lead({ candidate_id: "place:example-1" })] })
    expect(result.success).toBe(false)
  })

  it("verifies Resend/Svix signatures and rejects stale payloads", () => {
    const rawBody = JSON.stringify({ type: "email.delivered", data: { email_id: "msg-1" } })
    const nowMs = 1_700_000_000_000
    const timestamp = String(Math.floor(nowMs / 1000))
    const secret = `whsec_${Buffer.from("test-secret").toString("base64")}`
    const signature = createHmac("sha256", Buffer.from("test-secret")).update(`svix-1.${timestamp}.${rawBody}`).digest("base64")
    expect(verifyResendWebhookSignature({ rawBody, secret, svixId: "svix-1", svixTimestamp: timestamp, svixSignature: `v1,${signature}`, nowMs })).toBe(true)
    expect(verifyResendWebhookSignature({ rawBody, secret, svixId: "svix-1", svixTimestamp: timestamp, svixSignature: "v1,invalid", nowMs })).toBe(false)
    expect(verifyResendWebhookSignature({ rawBody, secret, svixId: "svix-1", svixTimestamp: timestamp, svixSignature: `v1,${signature}`, nowMs: nowMs + 10 * 60 * 1000 })).toBe(false)
  })

  it("keeps the internal ingest response free of private fields", () => {
    const route = readFileSync("app/api/internal/v1/dataengine/reservevia/leads/route.ts", "utf8")
    expect(route).not.toContain("source_payload")
    expect(route).not.toContain("business_contact_email")
    expect(route).not.toContain("request_hash")
    expect(readFileSync("lib/dataengine-reservevia.ts", "utf8")).not.toContain('@playwright/test')
    expect(readFileSync("lib/dataengine-reservevia.ts", "utf8")).not.toContain('waitUntil: "networkidle"')
    const hardening = readFileSync("supabase/migrations/20260822114730_dataengine_reservevia_hardening.sql", "utf8")
    expect(readFileSync("supabase/migrations/20260822101703_dataengine_reservevia_import.sql", "utf8")).toContain("enable row level security")
    expect(hardening).toContain("email_provider_webhook_events")
    expect(hardening).toContain("email_delivery_attempts")
    expect(readFileSync("supabase/bootstrap/reservevia-schema.sql", "utf8")).toContain("claim_dataengine_import_batch")
  })

  it("keeps production ingress, cron, and credential boundaries explicit", () => {
    const route = readFileSync("app/api/internal/cron/email-outbox/route.ts", "utf8")
    const credential = readFileSync("scripts/dataengine-credential.mjs", "utf8")
    const migration = readFileSync("supabase/migrations/20260822130000_dataengine_outbox_observability.sql", "utf8")
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"))
    expect(route).toContain("export async function GET")
    expect(route).toContain("export async function POST")
    expect(route).toContain('request.headers.get("x-vercel-cron-schedule")')
    expect(route).not.toContain('request.headers.get("x-vercel-cron") === "1"')
    expect(route).toContain("email_outbox_runs")
    expect(credential).toContain('const DATAENGINE_SCOPE = "dataengine:reservevia:write"')
    expect(credential).toContain("RESERVEVIA_API_CREDENTIAL_PEPPER")
    expect(credential).toContain('credentialReturnedOnce: true')
    expect(migration).toContain("create table if not exists public.email_outbox_runs")
    expect(migration).toContain("trigger text not null")
    expect(migration).not.toContain("trigger_type text not null")
    expect(migration).toContain("revoke all on public.email_outbox_runs from public, anon, authenticated")
    const triggerTypeMigration = readFileSync("supabase/migrations/20260823051610_dataengine_outbox_trigger_type.sql", "utf8")
    expect(triggerTypeMigration).toContain("rename column \"trigger\" to trigger_type")
    expect(triggerTypeMigration).toContain("has_trigger and has_trigger_type")
    expect(triggerTypeMigration).toContain("refusing to choose a column or discard data")
    expect(readFileSync("supabase/bootstrap/reservevia-schema.sql", "utf8")).toContain("trigger_type text not null")
    expect(readFileSync("types/supabase.ts", "utf8")).toContain("trigger_type: string")
    expect(readFileSync("types/supabase.ts", "utf8")).not.toContain("\n          trigger: string")
    const resendRoute = readFileSync("app/api/webhooks/resend/route.ts", "utf8")
    expect(resendRoute).toContain("email.complained")
    expect(resendRoute).toContain("email.suppressed")
    expect(readFileSync("supabase/migrations/20260823093000_resend_delivery_lifecycle.sql", "utf8")).toContain("email.complained")
    expect(vercel.crons).toEqual(expect.arrayContaining([{ path: "/api/internal/cron/email-outbox", schedule: "0 * * * *" }]))
    expect(readFileSync("docs/DATAENGINE-RESERVEVIA-PRODUCTION-RUNBOOK.md", "utf8")).toContain("DATAENGINE_RESERVEVIA_AUTOMATIC_EXPORT=false")
  })
})
