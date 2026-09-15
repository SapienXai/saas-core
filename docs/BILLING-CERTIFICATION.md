# Reusable billing certification

This document records the local release-boundary review for the coordinated
SaaS Core runtime/package release `2.5.0` and Core schema compatibility
coordinate `2.0`. The release delivers the additive, Core-managed migration
sources `supabase/migrations/20260909094344_reusable_billing_persistence.sql`,
`supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`,
`supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql`,
`supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`, and
`supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql`
from both the repository root and the canonical application template. It
certifies the packed Core contract, reusable billing boundary, and managed-
template lifecycle proof, including the controlled legacy-consumer upgrade.
It does not certify either consumer's migration apply/verification or a live
payment rollout. The release overview is [RELEASE-2.5.0.md](./RELEASE-2.5.0.md);
the prior coordinated boundaries remain in [RELEASE-2.4.0.md](./RELEASE-2.4.0.md)
and [RELEASE-2.3.0.md](./RELEASE-2.3.0.md).

This is tag-level certification evidence for `saas-core-v2.5.0`, not a claim
about every later commit on `main`. Post-tag runtime, template or migration
changes require fresh release-gate and certification evidence before being
called part of a public release.

The audited reference commits are ReserveVia
`92ffa98dd22e785d90959b292c341de1e57e6873` (`fix(ui): streamline public brand
booking header`) and PlaceDJ
`5fd2765bf3b36dd2be8e6c9105e40d410f4bc995` (`Refine catalog track detail and
background processing UI`). Both consumer checkouts were treated as read-only;
this run did not edit either repository. The current PlaceDJ checkout may carry
later product-owned working-tree changes, which are outside this certification.

## Consumer questions

### 1. What does Core own?

Core owns the provider-neutral billing contract, runtime and schema
compatibility coordinates, the additive migration sources
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` and
`supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`,
`supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`, and
`supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql`,
workspace-scoped provider mapping, checkout and mutation journal boundaries,
verified webhook projection, reconciliation, past-due grace and effective-plan
policy, generic entitlements, target-plan downgrade eligibility, billing actions, and the managed plan and
confirmed-success surfaces. The application template carries the source and
the server routes/UI integration; the Core package exports pure types and
deterministic helpers. Paddle remains behind the managed server adapter and is
never called by the browser or by the provider-neutral package.

Each product owns its identity, plan keys, prices, provider price mappings,
feature and limit keys, usage metrics, presentation copy, routes, styles,
migrations, and domain writes. Core does not interpret a product's domain
entities or catalog names.

### 2. What must ReserveVia migrate?

ReserveVia must preserve its existing provider customer and subscription IDs,
event and transaction history, current entitlements, and legacy custom-data
values while mapping them to the generic workspace and environment boundary.
It must provide its plan and price catalog, comparison and recovery copy, and
domain-specific limits and usage writes in product-owned configuration and
server actions. Its provider calls, webhook entry point, and plan actions must
move behind the managed Core contract without creating a second projection.

Before rollout it must prove a sandbox checkout, upgrade and deferred
downgrade, cancellation and resume, past-due recovery, canceled-subscription
replacement, duplicate and out-of-order events, and migration rollback.

### 3. What must PlaceDJ migrate?

PlaceDJ must begin with `saas-core diff` and `update --dry-run`, resolve every
managed conflict explicitly, and keep product-owned routes, styles, catalog,
migrations, and domain files intact. It must define its paid plans, prices,
presentation, and venue, device, music, and catalog limits and usage metrics
in product-owned configuration. Authorized product writes must call the Core
entitlement and usage boundaries.

PlaceDJ must preserve any existing provider IDs and history, map legacy
custom-data values, and prove sandbox lifecycle, recovery, rollback, and
relocation before a live migration. It must use the Core provider adapter,
webhook projection, and checkout flow; a second provider client, webhook, or
checkout engine is not part of the integration.

### 4. How are package and schema compatibility handled?

The current coordinates are runtime `2.5.0` and schema compatibility coordinate
`2.0`. All five Core packages use the runtime coordinate, while the CLI is a
tooling dependency and the application package is the template carrier for the
managed migration sources. Package packing and CLI `init`/`update` deliver
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` and
`supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`,
`supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql`,
`supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`, and
`supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql` as
source and never execute SQL. The consumer owns migration ordering,
application, and database verification. `doctor` reports source readiness, consumer presence
and hash readiness, and manifest ownership/readiness separately; its database
metadata check runs only with server credentials. Missing credentials produce a
database warning, while missing or changed source, consumer, or manifest state
produces an error. `diff` reports runtime movement separately from schema
movement; the controlled legacy fixture upgrades package versions and runtime
metadata from the legacy coordinate to `2.5.0` while keeping compatibility coordinate `2.0`.
The updater does not rewrite consumer lockfiles or apply SQL.

An explicit downgrade is separately validated against authoritative usage:
finite target limits require `current <= targetLimit`, `null` is unlimited,
and missing configuration or unavailable usage returns a structured violation
instead of allowing the provider mutation. The managed action checks during
preview and again at confirmation. Cancellation is a separate provider
lifecycle action and remains available even when current usage exceeds the
fallback plan; existing resources are retained and only new restricted writes
are blocked after the effective boundary.

### 5. How do managed ownership and conflicts work?

The CLI records hashes for Core-managed template files and product-owned path
boundaries in `.saas-core-manifest.json`. The billing and plan-catalog sources at
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` and
`supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`,
`supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`, and
`supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql` are
Core-managed; product catalogs, styles, routes, flat Product migrations not
claimed by Core, legacy `supabase/migrations/product/**`, and domain files are excluded from managed
replacement. An untouched managed file is backed up and updated. A locally
modified managed file, including a same-path consumer file at the Core billing
migration path, blocks the entire update before mutation and is reported as a
conflict. An apply or post-update validation failure restores the independent
backup, including package and manifest state, and removes newly added managed
files. The lifecycle fixture and packed consumer proof cover dry-run/apply
parity, product preservation, conflict isolation, rollback, and relocation.

### 6. How were billing, webhook, and persistence proofs run?

The local checks exercise the pure contract, Paddle normalization and raw-body
signature boundary, canonical lifecycle projection, ordering and grace
policy, durable webhook leases and retry states, unknown outcomes, and
exactly-once transition consumption. The catalog and schema-doctor fixtures
exercise explicit defaults, product keys, usage metrics, RLS metadata, and
schema mismatch handling. `core:pack` builds and packs the Core, config, UI,
app, and CLI artifacts, carrying the Core-managed billing migration sources.
`core:consumer-proof` installs those tarballs through a disposable local
registry as a deterministic packaging proof (published consumers use the same
immutable coordinates from npm), executes packed billing exports and config validation, initializes a
fresh consumer, upgrades a legacy consumer with the managed billing files, and
verifies product-owned preservation. The same proof relocates the consumer and
repeats a frozen install and build; the focused lifecycle fixture also checks
source delivery, dry-run/apply parity, same-path conflict isolation, rollback,
and removal of a newly added migration source on rollback. No CLI step applies
SQL; consumer apply and database verification remain a separate workstream.

No live Paddle request, provider mutation, production database write, deploy,
push, merge, or secret change is included in these checks.

### 7. Which environment-dependent checks were skipped?

The local Supabase shell proof and browser shell proof are conditional on a
running isolated local Supabase project with service credentials; they are
reported as skipped when that environment is unavailable. `doctor` keeps its
source, consumer, and manifest readiness checks independent from the
credential-dependent database check: absent server-only schema credentials
produce a warning, while missing or mismatched database metadata produces an
error. Root/template Platform Users parity is enforced before packing;
generated Supabase `.temp` code and intentional negative vocabulary assertions
are excluded from source scans, while the actual integration and schema gates
remain mandatory.

### 8. What is explicitly out of scope?

Consumer migrations, product-domain refactors, live Paddle/payment calls,
production mutations, credentials and secrets, deploys, pushes, merges,
destructive resets or migration rewrites, lockfile publication, metered or
add-on billing, and multiple recurring base subscriptions are out of scope.
ReserveVia and PlaceDJ remain separate read-only migration workstreams.
