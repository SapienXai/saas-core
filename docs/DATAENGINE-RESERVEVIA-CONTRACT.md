# DataEngine → ReserveVia import contract

This is the ReserveVia-side contract for the DataEngine `main` branch. It is
an internal, versioned API and is not part of the public restaurant or agent
API. ReserveVia keeps the v1 request shape backwards compatible and adds
private lifecycle fields to the response.

## Endpoint, authentication and limits

```text
POST /api/internal/v1/dataengine/reservevia/leads
Authorization: Bearer rv_live_...
Content-Type: application/json
```

The bearer is an API-client credential issued in Platform Control. The
credential is stored as a hash and must have only the
`dataengine:reservevia:write` scope. It is server-to-server only: never put it
in a browser bundle, exported lead file, or log. The endpoint is Node-only,
rate-limited per API client, rejects payloads over 20 MiB, uses `no-store`, and
returns the existing ReserveVia API error envelope.

`batch_id` is the transport idempotency key. Reusing it with the same canonical
body is a safe replay. Reusing it with a different body returns `409
IDEMPOTENCY_CONFLICT`. Duplicate `candidate_id` values within one request are
rejected with `400 INVALID_REQUEST` before any database write.

## Request

`contract_version` must be exactly `reservevia.dataengine.leads.v1`.

```json
{
  "contract_version": "reservevia.dataengine.leads.v1",
  "batch_id": "reserve-run-2026-08-22-istanbul-001",
  "source_run_id": "run-2026-08-22-istanbul",
  "source_export_id": "export-001",
  "scoring_version": "reservevia-fit-v1",
  "generated_at": "2026-08-22T08:00:00.000Z",
  "leads": [
    {
      "candidate_id": "place:example-123",
      "place_id": "example-123",
      "name": "Example Restaurant",
      "city": "Istanbul",
      "address": "Example Mah. Example Sok. 1",
      "official_website_url": "https://example-restaurant.test",
      "official_domain": "example-restaurant.test",
      "candidate_status": "shortlisted",
      "classification": "best_matches",
      "fit_score": 87,
      "data_confidence": 91,
      "scoring_version": "reservevia-fit-v1",
      "enrichment_status": "enriched",
      "business_match": "strong",
      "website_data": {
        "canonical_url": "https://example-restaurant.test/",
        "official_domain": "example-restaurant.test",
        "site_name": "Example Restaurant",
        "emails": ["reservations@gmail.com"],
        "phones": ["+90 212 000 00 00"],
        "menu_urls": ["https://example-restaurant.test/menu"],
        "reservation_urls": [],
        "opening_hours": ["Mon-Sun 12:00-23:00"],
        "cuisine": ["Turkish"],
        "hero_image_url": "https://example-restaurant.test/assets/hero.jpg"
      },
      "evidence": [
        {
          "field": "business_contact_email",
          "value": "reservations@gmail.com",
          "source_url": "https://example-restaurant.test/contact",
          "source_type": "official_website",
          "extraction_method": "mailto",
          "confidence": "high",
          "business_match": "strong",
          "scope": "venue",
          "observed_at": "2026-08-22T07:59:00.000Z"
        },
        {
          "field": "site_name",
          "value": "Example Restaurant",
          "source_url": "https://example-restaurant.test/",
          "source_type": "official_website",
          "confidence": "high",
          "business_match": "strong",
          "scope": "venue"
        }
      ],
      "banner": {
        "source_type": "official_hero",
        "url": "https://example-restaurant.test/assets/hero.jpg",
        "content_type": "image/jpeg",
        "width": 1600,
        "height": 900
      }
    }
  ]
}
```

Email evidence is a first-party publication check, not a domain-ownership
check. A Gmail or Outlook address explicitly published on the verified venue
website can be used for reservation notification. It does not make that
mailbox eligible for official-domain claim verification. Evidence must be
high-confidence, venue-scoped, and from the official domain or a trusted same-
site subdomain. Google, map, parent/global brand, other-venue, or unverified
strings do not qualify.

## Response

The response deliberately omits email values, evidence values, source payload,
request hashes, credentials, and claim tokens.

```json
{
  "contract_version": "reservevia.dataengine.leads.v1",
  "request_id": "reservevia-request-uuid",
  "replayed": false,
  "batch": {
    "id": "reservevia-batch-uuid",
    "external_batch_id": "reserve-run-2026-08-22-istanbul-001",
    "status": "needs_review",
    "ingest_phase": "completed",
    "ingest_attempt_count": 1,
    "total_leads": 1,
    "ready_leads": 0,
    "needs_data_leads": 1,
    "conflict_leads": 0,
    "approved_leads": 0,
    "published_leads": 0,
    "rejected_leads": 0
  },
  "leads": [
    {
      "id": "reservevia-lead-uuid",
      "external_candidate_id": "place:example-123",
      "readiness_status": "needs_data",
      "review_status": "pending",
      "publish_status": "pending",
      "banner_status": "pending",
      "restaurant_id": null,
      "duplicate_restaurant_id": null,
      "conflict_reason": "Missing stored banner.",
      "staged_banner_source_type": null,
      "staged_banner_width": null,
      "staged_banner_height": null
    }
  ]
}
```

New ingest returns `202`; a completed or in-flight safe replay returns `200`
with `replayed: true` only for a successfully completed/reviewable batch. A
failed or recovery batch is never treated as a successful replay; the same
body may reclaim its recovery lease and continue. The lifecycle statuses are
`received`, `processing`, `failed`, `recovery_required`, `needs_review`,
`publishing`, `partially_published`, `published`, and `rejected`.

## ReserveVia lifecycle and publish rules

1. **Ingest**: batch, lead snapshots, evidence, and identity reservations are
   private service-role data. A database lease makes concurrent retries safe.
   The identity key is unique across batches; only one lead owns it. Failed or
   rejected leads release only unlinked reservations. Once a real restaurant is
   created, the identity lock points to that `restaurant_id`.
2. **Readiness**: automatic `ready` requires `business_match=strong`, a
   reliable enrichment status, `data_confidence >= 80`, verified official
   website/domain, official website name evidence, first-party website email,
   local staged banner, and no identity/venue conflict. `probable`, ambiguous,
   partial, low-confidence, missing-name, and missing-asset records stay in
   `needs_review` or `needs_data`.
3. **Banner staging**: ReserveVia first validates official hero, OG, or
   same-site official images and stores them in the private
   `dataengine-import-assets` bucket. Images are not hotlinked. The fallback is
   a controlled 1440×800 desktop screenshot of the official website. The
   screenshot is accepted only when the page is not an obvious challenge/error/
   empty page and the image passes minimum dimensions, aspect-ratio, and
   contrast checks. The operator sees the source type, source URL, and preview.
4. **Approval and publish**: Platform owner/admin can approve one or many
   already-ready leads. A publish lease and transaction-backed provisioning
   saga make tenant creation retryable. The restaurant/workspace, claim profile,
   public banner, identity, and lead are linked before the lead becomes
   `published`. Public banner copy goes from private Storage to the
   `restaurant-assets` bucket using an idempotent deterministic path. One bulk
   failure does not roll back successful leads; failed records show the error
   and have a retry action.
5. **Manual override**: only platform owner/admin can override readiness for a
   single lead. A non-empty reason is mandatory; identity conflicts and bulk
   overrides cannot be bypassed. The actor user ID and reason are audited.
6. **Claim**: approved DataEngine restaurants are published as `unclaimed`.
   Claiming keeps the existing restaurant and workspace IDs and transfers
   control through the existing claim flow.

## Claimed restaurants and public data

After claim, new DataEngine records are stored as private snapshots and
`claimed_update_suggestion` values. They can be reviewed in Platform Control,
but no automatic field fill, banner change, status change, domain/email change,
or claim-profile update is performed. An explicit future owner-approved
mechanism would be required for changes.

The public profile name must come from `website_data.site_name` backed by
official website evidence. The Google/Place `lead.name` is never silently
used as the public name. Google rating, review count, Maps URL, Place ID,
Google phone/address, fit score, confidence, private email, evidence, and
claim tokens remain private provenance or deduplication data.

## Screenshot runtime and Storage

Production needs the `playwright-core` and `@sparticuz/chromium` runtime
dependencies installed by this repository. A deployment may instead set
`RESERVEVIA_SCREENSHOT_EXECUTABLE_PATH` to its managed Chromium binary. If no
browser is available, staging fails with `SCREENSHOT_RUNTIME_UNAVAILABLE` and
the lead remains `needs_data`; no fake banner is accepted.

Screenshot navigation uses a 15-second `domcontentloaded` timeout, a bounded
settling delay, response status checks, same-domain navigation, private-host
DNS/SSRF checks, and blocked external browser requests. It does not wait for
`networkidle`, so analytics connections cannot hold the job forever. Cookie
walls, challenge pages, server errors, empty pages, and unusable dimensions
are rejected. The official URL and all image redirects are revalidated.

Required Storage buckets are private `dataengine-import-assets` for operator
preview and public `restaurant-assets` for approved public assets. No external
image URL is written to a public restaurant profile.

## Reservation email delivery

For an unclaimed DataEngine restaurant, a real reservation creates the normal
reservation access records and a durable `email_delivery_events` outbox event.
The transactional email contains reservation details, Accept/Decline links,
and Claim your restaurant CTA. The event payload and recipient are private.

The outbox worker claims events with a lease, records attempt count and provider
message ID, and retries transient failures with bounded exponential backoff.
`GET /api/internal/cron/email-outbox` is the Vercel Cron entrypoint and `POST`
is retained for an authorized manual run; both are protected by `CRON_SECRET`.
Resend/Svix
webhooks at `/api/webhooks/resend` require `RESEND_WEBHOOK_SECRET`; provider
event IDs are idempotent and status ranking prevents an out-of-order delivered
event from downgrading or resurrecting a hard failure. Hard bounce, permanent
failure, and retry exhaustion are visible in Platform Control. A hard-bounced
unclaimed profile is paused for new booking notifications until its email is
corrected; bookings do not silently accumulate without notification.

## Required environment and operational configuration

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
CRON_SECRET
RESERVEVIA_API_CREDENTIAL_PEPPER
RESERVEVIA_SCREENSHOT_EXECUTABLE_PATH (optional when bundled Chromium is used)
```

Credential issuance, rotation, revocation, scheduler rollout, migration gates,
and the private-review-only smoke procedure are documented in
`docs/DATAENGINE-RESERVEVIA-PRODUCTION-RUNBOOK.md`.

The service-role key, API credential, business email, private evidence, claim
token, screenshot internals, and provider secrets are server-only. Apply the
DataEngine base migration followed by
`20260822114730_dataengine_reservevia_hardening.sql`; production bootstrap
generation includes both migrations.

## DataEngine follow-up

- Use only `dataengine:reservevia:write` and keep the credential server-side.
- Keep `candidate_id`, `place_id`, and `batch_id` stable for transport retries.
- Export official website name and venue-scoped email evidence, plus banner
  candidates, while retaining source URLs and confidence metadata.
- Treat `202` as accepted into private review, never as public publication.
- Persist ReserveVia `request_id`, external batch ID, and additive status fields
  in DataEngine export history without persisting the credential.
- Do not export Google-derived catalog values as public restaurant content.
