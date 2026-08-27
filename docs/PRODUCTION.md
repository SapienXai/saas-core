# Reservevia production readiness

This runbook records the Phase 10A staging boundary. It is deliberately conservative: it prepares a production-like Reservevia environment without changing `reservevia.com` DNS, enabling Paddle Live, importing Felix data, or touching FelixRez infrastructure. Phase 10B is the separately approved production cutover.

## Environment boundaries

Reservevia has three explicit environments:

| Environment | Database | Billing | URLs | Data policy |
| --- | --- | --- | --- | --- |
| Local | isolated Supabase CLI project on ports 54521–54524 | local/manual catalog | localhost and local host simulations | Felix-compatible schema plus synthetic fixtures only |
| Staging | dedicated Reservevia Supabase project | Paddle Sandbox only | dedicated Vercel deployment/preview origin | synthetic test workspaces, users, restaurants, and reservations |
| Production | dedicated Reservevia Supabase project | Paddle Live only after Phase 10B approval | `reservevia.com`, `app.reservevia.com`, tenant/custom domains | no seed customer data |

No environment may use FelixRez credentials, project references, domains, DNS, or provider accounts.

## Security baseline

The current application is on Next.js `16.3.0`, with `eslint-config-next` aligned, Node.js 24 LTS, and pnpm 11.21.0. Recheck the official [Next.js security advisories](https://github.com/vercel/next.js/security/advisories) and the package audit immediately before Phase 10B.

The repository also includes:

- bounded server-side validation for public reservation input;
- a tenant-scoped public submission idempotency key;
- an atomic, short-window, hashed-client reservation abuse limiter;
- security headers in `next.config.mjs`, including production-only HSTS;
- a safe `/api/health` response that does not expose dependency details;
- production denial for the legacy database initialization/test-email routes;
- Reservevia defaults for system email, privacy contact, and calendar metadata.

These controls do not replace Supabase Auth limits, CAPTCHA, WAF/rate limiting, or provider configuration.

## Node 24 and CI

Reservevia declares Node 24. The canonical local validation command is:

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm test -- --run
pnpm run db:reset
pnpm run db:test
pnpm run build:local
```

`.github/workflows/quality.yml` repeats the minimum lint, typecheck, unit, build, local Supabase reset, integration test, and generated-type checks on Node 24 with pnpm 11. CI uses non-sensitive placeholders and does not require FelixRez or production credentials.

## Fresh Reservevia cloud bootstrap

`supabase/migrations/202608090000_felix_legacy_baseline.sql` is intentionally a local development reset baseline. It contains Felix-compatible structures and deterministic local rows. It must not be blindly pushed to a new Reservevia cloud project.

The supported fresh-cloud path is:

1. Start the isolated local Supabase project and run `npm run db:reset`.
2. Run `npm run db:bootstrap:generate`.
3. Review `supabase/bootstrap/reservevia-schema.sql`; generation fails if known Felix/test row markers are present.
4. Create an empty, dedicated Reservevia Supabase project.
5. Apply `reservevia-schema.sql` to the empty project using the authorized Supabase deployment procedure.
6. Apply `storage-policies.sql` and `production-seed.sql`.
7. Verify that only system catalog data, especially the four plan rows, is present.
8. Register the applied migration versions listed in `supabase/bootstrap/README.md` using the Supabase CLI migration repair procedure.
9. Apply all future migrations with the normal ordered migration workflow.

This is a schema-only bootstrap, not a customer-data migration. It contains no local users, Felix restaurants, test reservations, or staging fixtures. Staging fixtures are applied separately and are clearly synthetic. Production should normally receive only system catalog/configuration rows.

Local development continues to use `npm run db:reset`; cloud environments use the bootstrap once and then normal forward migrations. The generated Supabase types are produced from the local validated schema with `npm run db:types` and must not be hand-edited.

## Required environment manifest

The names below are the configuration contract. Values belong in the environment provider, never Git. `NEXT_PUBLIC_` values are browser-visible; all other secrets are server-only.

| Variable | Scope | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes | environment-specific Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | yes | Supabase browser key |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | yes | narrowly scoped privileged server operations |
| `SUPABASE_JWT_SECRET` | server-only | local/legacy | management-session compatibility |
| `NEXT_PUBLIC_SITE_URL` | public | staging/prod | canonical public site URL |
| `NEXT_PUBLIC_APP_URL` | public | staging/prod | management and auth link origin |
| `NEXT_PUBLIC_RESERVEVIA_APP_DOMAIN` | public | staging/prod | trusted app host used by PWA links |
| `PLATFORM_OWNER_EMAIL` | server-only | first platform bootstrap | verified owner email for initial platform access |
| `RESERVEVIA_ROOT_DOMAIN` | server | staging/prod | platform hostname classification |
| `RESERVEVIA_APP_DOMAIN` | server | staging/prod | canonical management/auth origin |
| `RESERVEVIA_CUSTOM_DOMAIN_TARGET` | server | domain operations | customer DNS CNAME target |
| `RESERVEVIA_RATE_LIMIT_SECRET` | server-only | staging/prod | hash salt for public abuse limiting |
| `MANAGEMENT_EMAIL` | server-only | if reservation mail is enabled | operational reservation recipient |
| `RESERVEVIA_SYSTEM_EMAIL_FROM` | server-only | if app email is enabled | verified application sender |
| `RESERVEVIA_SYSTEM_EMAIL_REPLY_TO` | server-only | staging/prod | controlled system reply-to |
| `RESEND_API_KEY` | server-only | if app email enabled | application email provider |
| `PRIVACY_NOTICE_CONTACT_EMAIL` | server-only | recommended | privacy contact displayed by the app |
| `PADDLE_ENVIRONMENT` | server-only | staging/prod | must be `sandbox` in Phase 10A |
| `PADDLE_API_KEY` | server-only | staging only if billing E2E | Paddle server API |
| `PADDLE_WEBHOOK_SECRET` | server-only | staging only if billing E2E | raw webhook signature verification |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | public | staging only if checkout E2E | Paddle client checkout token |
| `VERCEL_API_TOKEN` | server-only | domain operations | scoped Vercel API token |
| `VERCEL_PROJECT_ID` | server-only | domain operations | dedicated Reservevia project |
| `VERCEL_TEAM_ID` | server-only | if team-scoped | explicit Vercel team scope |
| `WEB_PUSH_PUBLIC_KEY` | server config, returned as public key | push-enabled env | Web Push public key |
| `WEB_PUSH_PRIVATE_KEY` | server-only | push-enabled env | Web Push private key |
| `WEB_PUSH_SUBJECT` | server-only | push-enabled env | VAPID contact subject |

Production must use separate Supabase, Paddle, Vercel, Resend/SMTP, VAPID, and monitoring credentials from staging. Rotate each credential independently. Never add a secret to `.env.example`.

The DataEngine production boundary has a separate runbook:
[`docs/DATAENGINE-RESERVEVIA-PRODUCTION-RUNBOOK.md`](./DATAENGINE-RESERVEVIA-PRODUCTION-RUNBOOK.md).
It covers the server-side credential CLI, email outbox cron, migration gates,
and the opt-in private-review-only smoke test. Automatic DataEngine export must
remain disabled until that runbook's rollout gate is completed.

## Auth, SMTP, and CAPTCHA

Staging Supabase Auth must use the staging app origin for Site URL, allowed redirect URLs, confirmation, recovery, and PKCE flows. Auth links must never point at production or Felix domains. Supabase Auth SMTP and Reservevia application email are separate concerns, even if they use the same vendor. Link tracking/rewrite must be disabled for single-use auth links.

Custom SMTP, real confirmation delivery, and real password-reset delivery require staging credentials and controlled test addresses. If unavailable, the status is `CONFIGURED BUT PROVIDER E2E PENDING`, not passed.

Configure a supported Supabase CAPTCHA provider for public signup, login, and recovery before launch. Local development remains exempt or uses a test configuration. Until provider credentials and a real staging verification exist, CAPTCHA is `NOT CONFIGURED — CREDENTIALS REQUIRED`. Review Supabase Auth rate limits rather than increasing them by default.

### Google sign-in

Login and signup use Supabase Auth's Google PKCE OAuth flow and return through `/auth/callback`, which then delegates to the existing `/auth/continue` account-state redirect. A first Google sign-in therefore follows the existing onboarding path; an existing authenticated user keeps the existing workspace/profile and protected-route behavior.

Apple sign-in is intentionally disabled and is not exposed in the Reservevia login or signup UI. The Supabase Apple provider should remain disabled until Apple-specific credentials and a separate product decision are available.

The staging Supabase redirect allowlist includes:

- `https://app.reservevia.com/auth/callback*`
- local callback paths for `localhost`, `127.0.0.1`, and the known development LAN addresses on ports 3000/3001

Hosted provider activation remains credential-dependent. Google requires a Web OAuth client ID and client secret with the Supabase callback URL `https://<project-ref>.supabase.co/auth/v1/callback`. Apple requires a Services ID, Apple Team ID/signing key material, and a generated OAuth client secret; Apple secrets must be rotated every six months. These provider secrets belong only in Supabase Auth configuration and must never be committed or exposed to the browser.

## Billing gate

Paddle must remain Sandbox in Phase 10A. Create or reuse one monthly Sandbox product/price mapping for Starter, Pro, and Business; store actual IDs in `billing_provider_prices`, never source code. The staging webhook is `/api/billing/paddle/webhook` and must verify the raw request signature.

The required Sandbox evidence is:

- Free → Starter checkout and verified webhook;
- Starter → Pro subscription reuse and entitlement update;
- cancellation/downgrade behavior and preserved data;
- Customer Portal session for Owner only;
- duplicate/out-of-order/unknown-price webhook handling.

Paddle Live, real charges, annual products, and live checkout are explicitly Phase 10B actions.

## Email and sender domain

Staging application mail uses non-production recipients. Validate team invitations, resend/revoke behavior, reservation notifications according to entitlement, and provider failure isolation. System mail must contain Reservevia application URLs, not Felix URLs.

Before launch choose a sender scheme such as `notifications@reservevia.com` and document the required SPF, DKIM, and DMARC records. Do not change DNS from this phase. The final sender and DNS values require business/domain-owner approval.

## PWA and push

Use a dedicated staging VAPID key pair. Never reuse Felix credentials or commit the private key. Verify that Pro/Business push delivery uses current workspace membership and restaurant access at send time, minimizes lock-screen PII, removes dead endpoints, and never rolls back a reservation.

The required browser evidence is a Chromium staging push test, including notification click authorization and revoked restaurant access. Android and iOS/iPadOS real-device tests are separate launch checklist items if devices are unavailable. Inspect Cache Storage after authenticated use, workspace switching, logout, and offline reload; no reservation, guest, billing, or team response may be served from the management service-worker cache.

## Application security boundaries

Every Server Action and Route Handler is treated as a public HTTP surface. Mutations must authenticate, derive tenant scope server-side, authorize role/restaurant access, validate input, enforce entitlement/limits, and return safe errors. Public reservation creation is the intentional exception to membership: it resolves a published hostname-locked restaurant and uses the reservation engine, quota trigger, rate limiter, and idempotency key.

Service-role access is permitted only for server-only operations that need it, such as public reservation insertion, provider webhooks, privileged reconciliation, and controlled setup/cleanup. It must never be exposed to browser code or used without repeated authorization. Logs must not contain passwords, tokens, provider signatures, VAPID private keys, push endpoint URLs, guest contact details, or payment data.

The security headers are intentionally conservative. CSP allows only the external origins required by the current Next.js app, Supabase, Paddle, public images, and existing Font Awesome assets. Revalidate this allowlist after every provider integration change. HSTS is emitted only in production HTTPS deployments.

## Abuse protection and reliability

The public reservation endpoint has bounded field validation, a short-window hashed-client limiter, and a client-generated idempotency key scoped to the restaurant. The database unique index and server lookup prevent a network retry from creating a duplicate reservation. The atomic workspace quota remains separate and authoritative. Do not retain raw IP addresses as a product data field.

Staging should exercise duplicate submissions, rapid attempts, invalid payloads, quota exhaustion, availability races, and tenant-host forgery. A rate-limit response must never roll back a previously committed reservation, and notification/provider failure must never roll back reservation creation.

## Backup, restore, and rollback

Before any production migration take a verified database backup. Select a Supabase plan that provides the required automatic backup/PITR capability after an RPO/RTO decision. Recommended initial targets are an RPO of 24 hours and an RTO of 4 hours unless the business chooses stricter targets.

The staging restore drill is a fresh project bootstrap plus safe synthetic seed, followed by Auth, RLS, Storage, reservation, billing-schema, domain, team, PWA, and push smoke tests. Do not claim PITR was tested unless a real PITR restore was performed.

Migrations are forward-safe and additive where possible. Prefer rolling the application back to a prior compatible commit; do not promise destructive down migrations. If a schema rollback is unsafe, ship a forward compatibility fix. Vercel application rollback should select the prior known-good deployment and should not require a DNS change.

## DNS inspection and Phase 10B cutover

The latest read-only inspection observed Spaceship nameservers:

```text
launch1.spaceship.net
launch2.spaceship.net
```

The inspection observed root A responses and did not return apex MX/TXT records from the available resolver query. This is not proof that email records do not exist: before cutover, obtain an authoritative export from the DNS provider and independently verify A, AAAA, CNAME, MX, TXT, CAA, SRV, SPF, DKIM, DMARC, and verification records. No DNS records or nameservers were changed in Phase 10A.

The future wildcard plan is:

1. freeze the final code SHA and take a database backup;
2. verify the dedicated Reservevia Supabase and Vercel projects;
3. deploy and smoke-test the production build on its generated deployment URL;
4. inventory and preserve every email/verification DNS record;
5. attach `reservevia.com`, `www.reservevia.com`, `app.reservevia.com`, and the wildcard using the current Vercel-supported method;
6. only then perform the explicitly approved DNS cutover;
7. verify root marketing, `www` redirect, app auth, one arbitrary hosted restaurant, SSL, and custom-domain behavior;
8. verify mail delivery, SPF, DKIM, DMARC, and all preserved verification records;
9. enable production SMTP, VAPID, monitoring, and only then Paddle Live after final approval.

Rollback preserves the previous nameservers and record export, uses a pre-agreed TTL plan, reverts DNS only with authorization, and rechecks mail and SSL after propagation. Normal application defects use Vercel deployment rollback, not DNS changes.

## Incident minimum playbook

- **Site down:** check `/api/health`, Vercel deployment status, and the prior deployment; roll back the application if the database contract remains compatible.
- **Database unavailable:** pause destructive operations, check Supabase status, keep the reservation failure message safe, and use the documented restore/escalation path.
- **Paddle unavailable:** preserve existing subscription state; do not grant access from a client response; reconcile after recovery.
- **Auth email failure:** keep account creation state safe, verify SMTP/template configuration, and do not expose tokens in support logs.
- **Domain issue:** keep existing verified local mappings working, inspect provider configuration, and do not force-reassign a customer domain.
- **Push failure:** record a redacted provider result, remove dead subscriptions, and keep the reservation committed.
- **Reservation abuse spike:** tighten the short-window limiter or platform rule, preserve legitimate bookings where possible, and review rate-limit logs without retaining raw guest PII.

## Launch classification and current Phase 10A status

P0 means a security, data-loss, payment, tenant-isolation, bootstrap, auth, or reservation failure. P1 means an important reliability or customer-experience gap. P2 means non-blocking polish.

At the time of this document, external staging services are not claimed as passed without credentials. Dedicated Supabase/Vercel projects, real Paddle Sandbox lifecycle, custom SMTP, CAPTCHA, production VAPID/device tests, monitoring provider activation, and custom-domain real E2E remain credential/device-dependent launch work. Phase 10B must not begin until these are either passed or explicitly accepted by the launch owner.

Professional legal review remains required for the Privacy and Terms drafts. The current documents are technical product drafts, not legal advice.
