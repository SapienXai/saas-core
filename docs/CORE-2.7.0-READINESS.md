# SaaS Core 2.7.0 verification

Candidate runtime and packages **2.7.0**, Core schema compatibility **2.0**.
Published baseline **2.6.2**, anchored by `saas-core-v2.6.2` at
`3ceca1c8e33e6d93e78fd9ee56094a6436a29e64`. The development branch was cut
from `8a879fb5554af1f2975ec533d777e8811adb8443` on main. The implementation was
`8532ccb39c886cafb16f32bc4d08c9257d902841`; the independent audit started at
`5f5483ac55ae46b4975ab9926cf98ae486070b1e` (two commits ahead of main, 106
changed files, no candidate PR or runs at the start). The candidate is unpublished.
The draft PR is the record for the exact audited head and its hosted checks.

## Confirmed defects and repairs

| Finding | Repair and evidence |
| --- | --- |
| Trial-to-system fixture cleared one side of the legacy date pair. PostgreSQL rejected the write with 23514. | Local reproduction and GitHub quality run [42997035523](https://github.com/SapienXai/saas-core/actions/runs/42997035523). The fixture clears both fields. The original check stays in force. |
| The failing fixture masked assertions that still expected a future downgrade to constrain current usage. | The assertions now check the current effective-boundary policy, including unresolved targets, active limits and boundary behavior. |
| A provider projection with complete identity and no paid-period end could grant paid entitlements. | App policy and the additive `require_provider_entitlement_period` migration require a current window. Tests cover missing, expired and valid periods. |
| An arbitrary forwarded hostname could select a different public Workspace when ingress allowed it. | Host is authoritative by default, with explicit opt-in for a trusted reverse proxy. Unit and generated product routing checks exercise the policy. |
| The Paddle branch had an implicit Stripe Sandbox to Paddle Live replacement exception and a local portal-token path without buyer email proof. | The candidate rejects cross-provider or cross-environment replacement, verifies the linked customer and subscription, and requires verified buyer email for Sandbox portal tokens. |
| The schema doctor test could select the wrong local Docker database when multiple fixtures were running. | The test checks the isolated Core API port, selects the exact project and container, and restores metadata in a finally block. |
| Generated trial types and several browser assertions lagged existing schema and UI. | Types regenerated from local Supabase. Browser assertions now cover the current signup, actual Mailpit delivery, and the current Appearance control. |

### Independent audit fixes

| Finding | Repair and evidence |
| --- | --- |
| An initial Stripe subscription could project from a known journal row without reading the exact Checkout Session's payment. A late async failure could win over a paid Session. | Re-read the scoped Checkout Session (or reuse the server's verified read), match session, Workspace, mutation, plan/interval, mode, customer and subscription, and require paid or Stripe's no-payment-required status. A stale event cannot replace a completed Checkout with an earlier state. |
| Stripe can advance subscription item dates while an invoice is still open. | For an existing subscription, extending the paid window requires a paid invoice with a matching subscription item, price, customer, environment, and service period. Paddle retains its completed-transaction proof and rejects shortening an existing paid period. |
| Mutation settlement could look up an ID from a different billing provider or environment. | Settlement and Paddle checkout recovery use the scoped journal; the local database fixture rejects foreign Workspace, provider, and environment. |
| SQL used the database timezone when interpreting old date-only periods. Cancellation, resume and system schedules could also differ between app and SQL. | Legacy dates now mean midnight UTC; matching stored states exercise both paths. Tests cover UTC and New York sessions, the spring DST boundary, and exact expiry and downgrade timestamps. |
| A forwarded protocol could alter a development redirect origin without an opted-in proxy. | Host remains authoritative by default. Forwarded protocol is accepted only with the same explicit trusted ingress opt-in. Redirects set the pathname without letting a double slash replace the verified origin. |
| PlaceDJ’s product-owned Next configuration imported a style policy helper absent from the managed replacement. | Keep the generic `loadProductCspStyleSources` export. Its strict origin validation is covered by a regression test; the disposable PlaceDJ build passed with the restored export. |
| The hosted full matrix ran only on main and schedules. | Label a same-repository PR `release-candidate` to run both jobs against its head SHA. Checks have read-only contents access and do not keep checkout credentials. Normal main, schedule and ordinary PR behavior stays in place. |

## Stage-one test matrix (historical; see draft PR for the independent rerun)

| Command or scenario | Result |
| --- | --- |
| `pnpm install --frozen-lockfile`, `pnpm verify` | Local source gate passed with Node 24.20.0 and pnpm 11.21.0. |
| `pnpm release:check` | Passed end to end with npm 11.6.2. The unit phase passed 299 tests with 29 integration-only skips, and the database phase passed 30 tests. Build, critical browser, package and consumer stages passed. |
| `pnpm db:reset`, `pnpm db:types`, `pnpm db:test:schema`, `pnpm db:test:clean` | Passed isolated Supabase schema, migration, deterministic type generation and integration checks. |
| `pnpm exec supabase db advisors --local --workdir . --level error --fail-on error` | No error-level findings in the local database. |
| `pnpm auth:e2e` | Passed Auth, onboarding, default plan and tenant scope. |
| `SAAS_CORE_FULL_E2E=1 pnpm e2e:full` | Six passed across Chromium desktop and mobile, Firefox and WebKit. Seven project-specific scenarios skipped by the existing browser matrix. |
| `pnpm e2e:critical` | Four passed and one project-specific skip. |
| `pnpm core:lifecycle` | Passed managed updates, flat migration ownership, conflicts, backup and rollback. |
| `pnpm core:consumer-proof` | Passed packed install, product route and component, concurrent quota and product RLS, trusted public rendering, upgraded fixture build, and relocation with a frozen reinstall and browser smoke. |
| Published 2.6.2 CLI to packed 2.7.0 CLI | Fresh 2.6.2 init, candidate diff, dry run, apply and doctor passed. Four dependency coordinates advanced, eight managed files were added, schema stayed 2.0, and product source and a flat migration were preserved. |
| `pnpm core:pack`, `pnpm release:packages`, `pnpm release:registry-preflight` | Five matching tarballs. Public registry preflight found all five 2.7.0 versions absent. |
| Stripe regression tests | SDK/provider fixtures cover checkout, schedule and webhook behavior. Local persistence checks cover correlation, idempotency, leases and transition consumption. |
| Paddle Sandbox fixtures | Provider HTTP mocks and local database checks cover signed payload verification, duplicate receipts, recovery after lost create response, cross-Workspace rejection, renewal verification, stale delivery, and portal buyer binding. |
| Paddle Live and external Sandbox checkout | Provider account checkout, charges, webhooks and portal unexecuted. No isolated account credentials were available. |
| Production domains and delivery | Vercel/DNS/TLS and production email delivery unexecuted. |
| GitHub quality and registry publication | The prior main workflow failure was inspected. The candidate workflow has only been exercised locally. npm still lists 2.6.2 as the published version. |

## Provider release boundary

Both adapters share the provider-independent subscription projection, receipt
journal, Workspace projection lease and entitlement policy. Core verifies
checkout and renewals from provider responses before advancing paid access.
Paddle annual-to-monthly scheduling remains a Sandbox-only path. An unknown
potentially billable operation stays blocked until reconciliation establishes
the provider outcome. A partial pause or resume without a recoverable outcome
requires operator investigation. The past-due grace policy is bounded by the
verified paid period and the recorded grace deadline. Validate actual Sandbox
event shapes and checkout behavior before enabling paid BookPlace plans.

The release and consumer commands use local Supabase and a disposable
registry. The updater copies managed migration source and leaves database
application to the consumer. Keep existing Stripe links in their configured
environment. Treat any provider migration as a separate audited operation.

## Subscription rollout

1. Take a normal backup and confirm the consumer migration ledger. Run the
   [read-only period audit](../scripts/audit-provider-periods.sql) from a
   review checkout with a read-only database connection:
   `psql -X -v ON_ERROR_STOP=1 -f scripts/audit-provider-periods.sql`.
   Use the intended connection via the normal secret store. The report counts
   active, trialing and past-due provider rows by provider and environment;
   flags can overlap. Expired rows can be expected after failed payments.
2. Rehearse on an isolated staging database. Triage incomplete, expired or
   unmapped states against the original account and environment. Verify the
   linked Workspace, customer, subscription, price and matching paid period.
   Replay a verified provider delivery or use the same scoped application
   reconciliation used by webhook processing. Re-run the diagnostic after
   reconciliation. Route irreconcilable customers to support; never fill in
   dates or transfer provider identity based only on a local plan or callback.
3. Before an authorized cutover, pause new commercial changes if the report
   identifies unresolved active customers. Preserve signed webhook receipt and
   retry processing. Apply the new SQL migration first, then deploy the matching
   app and monitor fallback counts, blocked transitions, and retries. Confirm
   existing Workspace, billing and domain rows remain present. The SQL migration
   replaces the service-only entitlement function and writes no subscription data.
4. Keep the stricter database function during application recovery. If the old
   app would present a different entitlement decision, pause affected product
   writes and roll forward with a corrected runtime or scoped provider
   reconciliation. Keep the journal and provider links intact; do not relax the
   function or backfill entitlements from assumptions.

The isolated PlaceDJ rehearsal started from its 130 committed migrations and
applied only migration 131. The diagnostic counted seven synthetic Stripe
Sandbox active rows: one missing end, one expired end, one future start,
one valid legacy date-only end, one incomplete identity, and one unmapped
price. The remaining row had a valid timestamp period. Only the two valid
rows retained paid access. The migration closed previously granted access
for the missing end and the future start. Fingerprints for subscriptions,
Workspaces, billing accounts, billing mutations and domain mappings were
unchanged. No customer database or provider account was used.

`lock_workspace_entitlement` uses a fixed search path, an advisory transaction
lock per Workspace/capability, and a row lock on the subscription. Public,
anonymous and authenticated roles cannot execute it; approved server-side
product RPCs perform their own authorization before using it.

## Consumer compatibility

**PlaceDJ:** The starting manifest at
`ad2f90cf8630e097bea1317e178632791b8887a8` declares 2.6.2 / schema 2.0 and
source `d3239435850915d0b7bddfa0bdf6e30fadeba2df` (283 managed and 52
product-owned entries). Audit from a disposable `git archive HEAD` extraction:
run the candidate CLI's `doctor`, `diff --source /path/to/core`, then
`update --source /path/to/core --dry-run` before applying. The five managed
Paddle/provider/checkout files reconcile through the manifest. An intentional
edit to the managed Paddle adapter blocked update and preserved the original
edit and migration tree. The new flat
Core migration is copied as source; 114 product migrations stay outside
update ownership. PlaceDJ's plan actions/page, billing UI, proxy, Next
configuration, localization, player, venue, and product catalog remain
product-owned. Review those preserved billing and routing entry points in a
separate PlaceDJ change before any rollout; an update cannot certify their
product-specific behavior. Packed package install, typecheck, production build with fixture configuration, migration filename validation, and the isolated baseline-to-candidate SQL rehearsal passed.

**ReserveVia:** Read-only source inspected at
`92ffa98dd22e785d90959b292c341de1e57e6873`. It has its own Paddle client,
webhook, entitlement implementation and migrations, with no Core manifest or
Core package coordinates. It is a legacy source reference. Adopting Core
requires a separately designed migration and tenant/billing mapping; do not
run the updater over it.

## Provider acceptance

Level A uses mocked providers and local Supabase. Level B requires an actual
isolated Sandbox; no credentials were available to this audit. Level C was
out of scope. Paddle Live checkout stays disabled by default and the
annual-to-monthly pause/resume path stays Sandbox-only.

1. Provision a disposable application/database with test Workspaces and
   two test identities. Select one provider at a time with
   `SAAS_CORE_BILLING_PROVIDER` and `SAAS_CORE_BILLING_MODE=enabled`. Set
   `STRIPE_ENVIRONMENT=sandbox` or `PADDLE_ENVIRONMENT=sandbox`; use the
   matching API key, account binding, webhook secret and public Paddle test
   token from the Sandbox. Keep `PADDLE_LIVE_CHECKOUT_MODE` unset. Use a
   Sandbox-only HTTPS callback origin.
2. Sync the disposable product catalog. For Stripe, run
   `pnpm billing:register-price <plan-key> sandbox <product-id> <price-id> <month|year> <currency>`
   in the Sandbox project. For Paddle, verify monthly and annual IDs through
   the Sandbox API and insert their scoped mapping in `billing_provider_prices`
   through the disposable database's privileged tooling. Subscribe
   the provider endpoint to the events documented in
   [Billing architecture](./BILLING-ARCHITECTURE.md). Keep provider secrets
   server-only and use the provider's test payment details.
3. Complete an owner Checkout. Observe one provider Checkout/transaction,
   one durable mutation, and one linked subscription. Check unpaid and
   forged returns, webhook signature failure, duplicate delivery, and the
   wrong Workspace, customer, or environment. Verify the other identity
   cannot open the portal and the authorized buyer can.
4. Use Stripe Sandbox test clocks or Paddle Sandbox test fixtures supported
   by that account for a real successful and failed renewal. Confirm no
   extension from an unpaid invoice/transaction. Test cancel, undo, expiry,
   and replay. For Paddle, schedule annual-to-monthly, verify the original
   paid end, interrupt at pause/resume, reconcile, and confirm exactly one
   paid renewal at the new price. Unresolved provider operations stay blocked.
5. Record redacted event IDs, mutation outcomes, paid timestamps, and provider
   charge counts. A provider simulator alone cannot certify real checkout,
   renewal, or portal access. Keep paid Paddle disabled for consumers until
   Sandbox acceptance and separately authorized Live readiness. Require a
   Stripe Sandbox rehearsal before publishing the changed default Stripe
   renewal enforcement.
