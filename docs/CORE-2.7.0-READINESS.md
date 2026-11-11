# SaaS Core 2.7.0 verification

Candidate runtime and packages **2.7.0**, Core schema compatibility **2.0**.
Published baseline **2.6.2**, anchored by `saas-core-v2.6.2` at
`3ceca1c8e33e6d93e78fd9ee56094a6436a29e64`. The development branch was cut
from `8a879fb5554af1f2975ec533d777e8811adb8443` on main. The tested
implementation is `8532ccb39c886cafb16f32bc4d08c9257d902841`. The
candidate is unpublished.

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

## Test matrix

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
