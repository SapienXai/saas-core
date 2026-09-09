# Reusable billing certification

This document records the local release-boundary review for the coordinated
SaaS Core runtime/package release `2.2.0` and Core schema `2.0`. It certifies
the packed Core contract, reusable billing boundary, and managed-template
lifecycle proof, including the controlled `2.1.0` → `2.2.0` upgrade. It does
not certify either consumer's migration or a live payment rollout. The release
overview is [RELEASE-2.2.md](./RELEASE-2.2.md).

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
compatibility coordinates, workspace-scoped provider mapping, checkout and
mutation journal boundaries, verified webhook projection, reconciliation,
past-due grace and effective-plan policy, generic entitlements, billing
actions, and the managed plan and confirmed-success surfaces. The application
template owns the server routes and UI integration; the Core package exports
pure types and deterministic helpers. Paddle remains behind the managed server
adapter and is never called by the browser or by the provider-neutral package.

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

The current coordinates are runtime `2.2.0` and schema `2.0`. All five Core
packages use the runtime coordinate, while the CLI is a tooling dependency and
the application package is only a template carrier. `doctor` checks manifest,
package, migration, catalog, and (when server credentials are present) live
schema metadata. `diff` reports a runtime movement separately from schema
movement; the controlled legacy fixture upgrades package versions and runtime
metadata from `2.1.0` to `2.2.0` while keeping schema `2.0`. The updater does
not rewrite consumer lockfiles or apply database migrations.

### 5. How do managed ownership and conflicts work?

The CLI records hashes for Core-managed template files and product-owned path
boundaries in `.saas-core-manifest.json`. Product catalogs, styles, routes,
migrations, and domain files are excluded from managed replacement. An
untouched managed file is backed up and updated. A locally modified managed
file blocks the entire update before mutation and is reported as a conflict.
An apply or post-update validation failure restores the independent backup,
including package and manifest state, and removes newly added managed files.
The lifecycle fixture and packed consumer proof cover dry-run/apply parity,
product preservation, conflict isolation, rollback, and relocation.

### 6. How were billing, webhook, and persistence proofs run?

The local checks exercise the pure contract, Paddle normalization and raw-body
signature boundary, canonical lifecycle projection, ordering and grace
policy, durable webhook leases and retry states, unknown outcomes, and
exactly-once transition consumption. The catalog and schema-doctor fixtures
exercise explicit defaults, product keys, usage metrics, RLS metadata, and
schema mismatch handling. `core:pack` builds and packs the Core, config, UI,
app, and CLI artifacts. `core:consumer-proof` installs those tarballs through
a disposable local registry, executes packed billing exports and config
validation, initializes a fresh consumer, upgrades a legacy consumer with the
managed billing files, and verifies product-owned preservation. The same
proof relocates the consumer and repeats a frozen install and build; the
focused lifecycle fixture also checks dry-run/apply parity, conflict
isolation, and rollback.

No live Paddle request, provider mutation, production database write, deploy,
push, merge, or secret change is included in these checks.

### 7. Which environment-dependent checks were skipped?

The local Supabase shell proof and browser shell proof are conditional on a
running isolated local Supabase project with service credentials; they are
reported as skipped when that environment is unavailable. `doctor` reports a
warning when server-only schema credentials are absent. The full root build and
typecheck currently remain blocked by pre-existing template platform user
errors: the template platform user actions/page import helpers and
`platform-user-management` exports are missing. Full lint also sees generated
`supabase/.temp` code from local services. These failures are outside the
allowlist and were not hidden by weakening a check.

The generic `core:scan` remains blocked by its intentional test-only
vocabulary assertion in `test/billing-persistence.integration.test.ts`; the
assertion verifies that the reusable migration rejects product vocabulary. The
commercial scan passes.

### 8. What is explicitly out of scope?

Consumer migrations, product-domain refactors, live Paddle/payment calls,
production mutations, credentials and secrets, deploys, pushes, merges,
destructive resets or migration rewrites, lockfile publication, metered or
add-on billing, and multiple recurring base subscriptions are out of scope.
ReserveVia and PlaceDJ remain separate read-only migration workstreams.
