# DataEngine → ReserveVia production runbook

This runbook is for the ReserveVia side only. It assumes DataEngine `main`
contract `reservevia.dataengine.leads.v1` and keeps automatic export disabled
until a separately approved rollout.

## Production boundary and required configuration

ReserveVia must use a dedicated Supabase project, Vercel project, Resend sender
and webhook, and separate secrets from local/staging. These are server-only:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESERVEVIA_API_CREDENTIAL_PEPPER
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
CRON_SECRET
RESERVEVIA_SYSTEM_EMAIL_FROM
RESERVEVIA_SYSTEM_EMAIL_REPLY_TO
RESERVEVIA_SCREENSHOT_EXECUTABLE_PATH (optional; bundled Chromium is otherwise used)
```

`RESERVEVIA_API_CREDENTIAL_PEPPER` is a dedicated high-entropy secret. It is
not the rate-limit secret. Changing it invalidates all API credentials hashed
with the old value and therefore needs a separate approved rotation procedure.

The DataEngine-side variables are separate and remain:

```text
DATAENGINE_RESERVEVIA_AUTOMATIC_EXPORT=false
```

DataEngine production also requires a persistent SQLite volume, exactly one
active scheduler, manual dispatch, and an initial batch size of at most 5.

## Migration and deployment gate

Do not run a migration until the project reference is confirmed as the intended
ReserveVia staging or production database and a verified backup/restore point
exists.

Local/CI gate:

```bash
pnpm install --frozen-lockfile
pnpm exec supabase start --workdir .
pnpm run db:test:clean
pnpm run db:types
git diff --exit-code -- types/supabase.ts
pnpm run db:test
```

Controlled cloud rollout, only after target confirmation:

```bash
pnpm exec supabase link --project-ref <RESERVEVIA_TARGET_PROJECT_REF>
pnpm exec supabase migration list --linked
pnpm exec supabase db push --linked
pnpm exec supabase migration list --linked
```

The expected additive migrations include `20260822101703`,
`20260822114730`, and `20260822130000`. DataEngine private tables, Storage
policies, email delivery tables, and `email_outbox_runs` must exist before the
corresponding application deployment.

## Credential issue, rotate, revoke

The CLI requires a service-role key and a real platform actor UUID. It creates
only `dataengine:reservevia:write`, stores a peppered SHA-256 hash, and writes a
safe audit record. The raw secret is printed once; `--secret-file` writes it
once to a protected mode-0600 path. Never put it in a command argument, CI log,
ticket, browser request, or source file.

```bash
export SUPABASE_URL="https://<reservevia-project>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<server-only-value>"
export RESERVEVIA_API_CREDENTIAL_PEPPER="<server-only-value>"

pnpm dataengine:credential -- issue \
  --name dataengine-production \
  --actor-user-id <platform-owner-uuid> \
  --reason "Enable controlled DataEngine private review import"

pnpm dataengine:credential -- rotate \
  --revoke-client-id <old-client-uuid> \
  --name dataengine-production \
  --actor-user-id <platform-owner-uuid> \
  --reason "Rotate DataEngine production credential"

pnpm dataengine:credential -- revoke \
  --client-id <client-uuid> \
  --actor-user-id <platform-owner-uuid> \
  --reason "Disable DataEngine export during rollback"
```

Rotation creates and audits the replacement before revoking the old client. If
old-client revocation fails, stop export and revoke it before proceeding.
Re-running revoke on an already revoked client is a no-op and creates no
duplicate audit record.

## Email outbox and cron

The checked-in Vercel schedule invokes:

```text
GET /api/internal/cron/email-outbox
Authorization: Bearer <CRON_SECRET>
```

The repository uses the conservative hourly schedule compatible with its known
cron configuration. Reservation creation persists the notification and
attempts delivery immediately; cron is the durable retry sweep. Do not change
to a five-minute schedule until the actual Vercel plan and deployment access
are verified. The route also accepts authorized `POST` for manual recovery.

Each invocation gets a private `email_outbox_runs` row with only status/counts.
Delivery rows have leases, attempt history, provider message IDs, bounded
retry, and idempotent ordered webhook reconciliation. Platform Control shows
pending, sent, delivered, retrying, failed, bounced, and paused states without
publicly exposing payloads. A hard-bounced unclaimed profile is paused for
booking notification until the business email is corrected.

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$RESERVEVIA_BASE_URL/api/internal/cron/email-outbox"
```

Do not print `CRON_SECRET`, recipient addresses, or payloads while verifying.

## Controlled private smoke test

This smoke proves only authentication, private ingest (`202`), identical
replay (`200`, `replayed=true`), and same-batch/different-body conflict (`409`).
It never approves, publishes, creates a reservation, or sends email. The
payload must use a `smoke-` batch ID and `smoke:` candidate IDs, with 1–3 leads.

```bash
export DATAENGINE_SMOKE_CREDENTIAL="rv_live_<one-time-secret>"
export DATAENGINE_SMOKE_ALLOW_HOST="staging.reservevia.example"
pnpm dataengine:smoke -- \
  --base-url "https://staging.reservevia.example" \
  --payload /secure/path/private-smoke-payload.json \
  --confirm DATAENGINE_PRIVATE_REVIEW_ONLY
unset DATAENGINE_SMOKE_CREDENTIAL
```

Use only a controlled test domain and data. Review the batch in
`/platform/dataengine`; automatic publication remains off. A publish smoke is
a separate operator action and requires a restaurant/test mailbox owned by the
ReserveVia team. Never send a reservation email to an uncontrolled business
address. Use the provider sandbox/test mechanism for bounce testing.

## Review, publish, and recovery

1. Confirm the batch is private and its ingest phase is complete or a named
   recovery state; failed ingest is not a successful replay.
2. Confirm official website/domain evidence, first-party venue-scoped email,
   official name evidence, data confidence ≥ 80, strong business match,
   reliable enrichment, identity state, and a valid private Storage banner.
3. Review the banner source. Official hero/OG/site image is preferred;
   screenshot fallback identifies itself and passes runtime, SSRF, redirect,
   response, content-type, and quality checks.
4. Approve only the intended lead. Claimed restaurants remain unchanged and
   become private conflict/suggestion records.
5. Publish only after workspace provisioning and asset promotion are complete.
   Retry actions are idempotent and visible in Platform Control.

Google rating, review count, Maps URL, Place ID, Google phone/address, private
evidence, business email, and claim token are never public profile fields.

For rollback, keep `DATAENGINE_RESERVEVIA_AUTOMATIC_EXPORT=false`, disable
manual dispatch, revoke the DataEngine client with an actor and reason, leave
affected batches private, and use Platform Control retry for failed banner,
publish, or eligible email events. Correct a bounced email before resuming
notifications. Application rollback uses the previous Vercel deployment; keep
additive migrations applied and ship forward-compatible fixes.

## Controlled future export enablement

After local/CI and staging gates are green, with persistent DataEngine storage
and one scheduler confirmed, issue a dedicated credential, dispatch exactly one
batch of at most 5, observe the private queue and delivery telemetry, and only
then consider changing `DATAENGINE_RESERVEVIA_AUTOMATIC_EXPORT` in a separate
approved change. Successful ingest is never permission for automatic public
publication.
