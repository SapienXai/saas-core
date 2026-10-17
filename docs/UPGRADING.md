# Upgrading

SaaS Core 2.0 is a new source and schema baseline, not a minor UI release.
The old SaaS Core implementation is preserved locally on
`archive/pre-reservevia-rebuild`; the production ReserveVia checkout remains
the read-only canonical source used for extraction.

The current coordinated runtime and package release is tag `saas-core-v2.6.2`
on Core schema compatibility coordinate `2.0`. Its packed consumer contract
delivers the additive billing sources listed in
[`RELEASE-2.6.0.md`](./RELEASE-2.6.0.md) plus the Checkout lifecycle and
scheduled-downgrade runtime fixes documented in
[`RELEASE-2.6.2.md`](./RELEASE-2.6.2.md). The tag matches the current canonical
source set. Package packing and CLI `init`/`update` deliver sources but never
execute SQL; each consumer owns the controlled apply and verification
workstream. The Plan Catalog guide is shipped in the Core package as
`docs/PLAN-CATALOG.md`. The release evidence and certification boundary are
recorded in the versioned release notes, with the prior release retained in
[`RELEASE-2.4.0.md`](./RELEASE-2.4.0.md), and
[`BILLING-CERTIFICATION.md`](./BILLING-CERTIFICATION.md).

## Unreleased Checkout reconciliation follow-up on `main`

Post-2.6.2 source adds a fail-closed fast path for Checkout returns: it reuses
the local subscription only when Workspace, Stripe environment, subscription,
Price, plan, active status, and the durable succeeded transition all match the
verified paid Checkout Session. Otherwise the existing Stripe reconciliation
and projection path remains authoritative. The return path also passes its
already verified Checkout snapshot through validation instead of retrieving
the same Session twice. This does not change the database schema or grant
entitlement from browser state. The patch is currently on `main` after the
2.6.2 tag; it is not part of the published 2.6.2 package.

The managed entitlement runtime imports the product-owned server extension
`src/product/usage.ts`. Fresh consumers receive a neutral resolver registry;
updates preserve an existing registry and scaffold it only when a legacy
consumer does not have the file. The extension is not a Core-managed manifest
file and is never overwritten by an update.

## Core/product ownership

Keep Core-owned files and product-owned files separate. A normal product
extension is not an update conflict. A Core update should report changes to
authentication, Workspace authorization, billing, delivery, PWA, platform,
and shared UI files without overwriting product routes or migrations. Core
migration ownership is exact-path based: the current template plus the
consumer's managed manifest identify Core SQL, while an unknown flat
`supabase/migrations/*.sql` file is a preserved Product migration. Product
migrations may be chronologically interleaved with Core migrations; they do
not need to move into a nested directory. Flat means a direct-child SQL file
only. Arbitrary nested SQL outside the legacy
`supabase/migrations/product/**` namespace is preserved with a noncanonical
warning and is not assumed to execute through the normal Supabase flow.

Before accepting an update:

```bash
pnpm doctor -- ./my-product
pnpm diff -- ./my-product
pnpm update -- ./my-product
```

## Registry installation and update

The normal consumer path installs the coordinated packages from npm. A fresh
consumer uses the registry-published CLI to materialize the packed template:

```bash
pnpm add @sapienx/saas-core@^2.6.2 @sapienx/saas-core-config@^2.6.2 @sapienx/saas-core-ui@^2.6.2
pnpm add -D @sapienx/saas-core-cli@^2.6.2
pnpm exec saas-core init "My Product" ./my-product
pnpm install --dir ./my-product
```

For an existing consumer, update the four runtime/tooling package ranges with
the package manager, run `doctor`, inspect `diff --json`, and apply `update`
only after resolving any conflict. Then reinstall dependencies, apply and
verify Core-managed migration source through the consumer-controlled database
process, run product tests, and build/deploy through the product's own release
workflow. The CLI does not execute SQL.

The billing release boundary is documented in
[`BILLING-CERTIFICATION.md`](./BILLING-CERTIFICATION.md), with separate
consumer migration checklists in
[`CONSUMER-FOLLOWUPS.md`](./CONSUMER-FOLLOWUPS.md). Read those documents with
the product team before applying a billing update; they define the provider
history, legacy custom-data, catalog, usage, conflict, sandbox, and rollback
evidence each consumer must supply.

## Local source override (development only)

When both repositories are checked out locally, the existing lifecycle tool
can be pointed at the canonical Core source for development diagnosis:

```bash
node ../saas-core/packages/cli/bin/saas-core.mjs diff ../PlaceDJ --source ../saas-core --json
node ../saas-core/packages/cli/bin/saas-core.mjs update ../PlaceDJ --source ../saas-core --dry-run --json
node ../saas-core/packages/cli/bin/saas-core.mjs update ../PlaceDJ --source ../saas-core
```

The `--source` flag is a local-development override. It accepts a Core
repository (resolving `packages/app/template`) or a template directory and
does not alter release installation semantics. The command still reads the
consumer manifest, delivers the Core-managed migration source alongside other
managed files, blocks locally modified managed files, preserves every
product-owned path, creates the normal backup and runs the normal validation
and rollback path. It copies source and metadata only: it never executes SQL or
rewrites a lockfile.
When the source is a Git checkout, the update records only its 40-character
`coreSourceCommit` in the manifest, never the local filesystem path. This is
an optional field, so older manifests remain backward-compatible; a direct
template directory or packed release has no Git SHA to record.

`saas-core diff` compares the consumer against the managed-file hashes from
its manifest and reports Core, version, package, schema, and ignored product
changes separately. `saas-core update --dry-run` plans additions,
replacements, removals, package changes, and conflicts without mutation.
Untouched managed files are backed up and replaced; locally modified managed
files block the entire update and are reported as conflicts. A real update
preflights every source and destination, creates a complete independent backup
under `.saas-core-backups/`, applies the plan, validates the result, and
automatically restores the prior Core state if any post-mutation step fails.
The report includes the backup path and rollback result. Package versions are
updated in `package.json`; the CLI does not rewrite a consumer lockfile, so
run the consumer package manager without frozen-lockfile mode after an update
before committing a lockfile change.

For migrations, a new exact Core path is added only when it is absent or
already contains the same authoritative Core source. A different file already
occupying that exact path is a hard Core/Product collision. Unknown flat
Product migrations are reported separately as preserved and are never deleted,
renamed, retimestamped, or added to the managed manifest. Previously managed
Core migrations are immutable; historical drift or absence remains an error,
and new Core schema work must use an additive migration. Legacy nested Product
migrations remain preserved but are not the recommended layout for new work.

The updater never partially applies a plan when a conflict is present. Its
failure path restores replaced and removed managed files, `package.json`, and
`.saas-core-manifest.json`, and removes newly added Core files. A rollback
failure is reported as critical with both error messages and the independent
backup path; the CLI does not claim a healthy consumer in that case.

The `PRODUCT_CONFIG.shell` field is optional and product-owned. Consumers that
predate the shell extension continue using the Core Workspace dashboard;
updates add the managed resolver without overwriting `lib/product-config.ts`.
If a product adopts the extension, keep its routes under the product-owned
route boundary and do not claim Core-reserved `/app` paths.

Product-wide auth and management branding belongs in the product-owned
`styles/product-theme.css`, which the root layout loads after the managed
`styles/core-lilac.css`. Keep the file to token overrides and small extension
selectors; do not edit Core-managed auth/manage components or duplicate the
Core stylesheet. `styles/product.css` remains for product-route-only styles.

## Agent Surface update

Core updates add the managed Agent Surface files and preserve product-owned
configuration, routes, styles, capabilities, and migrations. Existing products
do not need a configuration switch or product tool registry merely to accept
the update. The new foundation is available but registers zero tools until a
product page explicitly renders `CoreWebMcpTools` with product-owned tools.

The Agent Surface has no schema-specific SQL. The same update also carries the
Core-managed billing and plan-catalog sources
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` and
`supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`, plus
`supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`,
while the Core schema compatibility coordinate stays `2.0`. Current `main`
also contains the platform-owner guard and fail-closed replacement migration;
consult `pnpm core:source-parity` for the exact source set. The CLI copies
the sources, never executes SQL, and leaves the consumer to apply and verify
them through its own migration process. Validate the normal lifecycle before
applying them:

```bash
node packages/cli/bin/saas-core.mjs diff ../product --source . --json
node packages/cli/bin/saas-core.mjs update ../product --source . --dry-run --json
```

The dry run should classify the Agent Surface files as Core-managed additions
or replacements. A locally changed managed Agent Surface file must still block
the entire update, and a failed apply must still roll back the prior consumer
state.

Review the generated manifest and run the product’s install, typecheck, test,
and build commands. Do not copy local `.env` files, `.next`, `node_modules`,
screenshots, or provider credentials between checkouts.

## Database changes

The baseline migration is clean and independent. The tagged `2.6.0` release carries
the generic, provider-neutral Core-managed sources
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` and
`supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`, and
`supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql`, and
`supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`, and
the additive domain foundation migration
`supabase/migrations/20260916120000_saas_core_domain_foundation_v1.sql`;
they are additive and present in both the repository root and
`packages/app/template`. Their delivery preserves the schema compatibility
coordinate `2.0`. Current `main` additionally carries the platform-owner guard
and fail-closed replacement migration; the exact branch source set is enforced
by `pnpm core:source-parity`. Product migrations under
`supabase/migrations/*.sql` that are not in the Core source/manifest set follow
the Core source, add Workspace-scoped tables with RLS, and remain
product-owned. Existing `supabase/migrations/product/**` files remain
compatible and product-owned. CLI `init`/`update` and package packing deliver
migration source only; the consumer controls ordering, SQL application,
verification, and any rollback of its database state. Never point a clean Core
reset at a live ReserveVia database, and never rewrite the source product's
migration history.

The additive `20260914110000_fix_renew_workspace_invitation.sql` migration is
delivered by the `2.6.0` coordinated Core update. It replaces the published
invitation-renewal function in place with qualified `RETURNING` columns, keeps
the existing RPC grants and behavior, and remains compatible with schema
coordinate `2.0`. It is source delivery only; the consumer applies it in its
normal migration workflow.

The additive `20260914185445_scheduled_downgrade_consumption_ceiling.sql`
migration keeps the active plan authoritative for display and features while
the entitlement lock applies the stricter finite quota for a pending explicit
downgrade. Scheduled cancellation, pause, and resume retain current-plan
limits until their lifecycle boundary. It is source delivery only; consumers
apply and verify it through their normal migration workflow.

The additive `20261015110000_effective_plan_limits_until_boundary.sql`
migration supersedes that early consumption ceiling. The current plan's limits
remain effective until the scheduled plan's timestamp; after the boundary the
target plan supplies the limit. Existing resources are preserved if usage is
then over the target, and new restricted mutations are blocked until usage is
reduced. The migration is source delivery only; consumers apply and verify it
through their normal migration workflow.

The additive `20260915120000_scheduled_provider_price_trust.sql` migration
hardens future provider-price transitions. It accepts only the current mapped
price or an exact active target mapping, keeps the current plan effective until
the boundary, preserves the transactional entitlement lock, and adds the
`interval_change` transition kind. It is source delivery only and remains
compatible with schema coordinate `2.0`.

The additive `20260916120000_saas_core_domain_foundation_v1.sql` migration
delivers the workspace-owned `public_sites` and `workspace_domains` contract.
It establishes globally unique normalized hostnames, one platform domain and
one primary domain per public site, while keeping domain resolution fail closed
for inactive workspaces or domains. The migration is source-only delivery and
keeps schema compatibility coordinate `2.0`.

For every schema update:

1. reset local Supabase from zero;
2. verify RLS and the public table boundary;
3. run cross-Workspace and role tests;
4. run type generation, unit tests, browser smoke tests, and a production
   build;
5. scan the generated consumer for absolute paths, `file:` dependencies, and
   product vocabulary.

Core runtime version and schema compatibility coordinate are separate. The
current runtime is `2.6.2` and the compatibility coordinate remains `2.0` even
though the release delivers additive billing, entitlement, and plan-catalog
sources. `doctor`
reports Core source readiness, consumer presence/hash readiness, and manifest
ownership/readiness separately. It verifies actual schema metadata only when
`SUPABASE_URL` and a server-only `SUPABASE_SERVICE_ROLE_KEY` are available;
absent credentials produce a database warning, while missing or mismatched
metadata is an error. A consumer must apply and verify the delivered migration
through its own controlled process. Changing a product catalog, default plan,
or usage metric does not alter the Core schema or migration source.

## Public Workspace routing

Public Workspace routing is a Core runtime boundary, not a product entity
router. Products may use `resolveHost()` or
`resolvePublicWorkspaceRequest()` from server code to receive the canonical
Domain → PublicSite → Workspace → productKey result plus normalized pathname,
then resolve their own product entity. Keep product route meaning and data in
product-owned files.

The canonical request-host extractor and `classifyHostname()` are shared by
proxy and public resolution. Do not add a second tenant-host parser, query
parameter override, or provider lookup to a page request. A future Core update
must preserve `lib/domains/hostname.ts`, `lib/route-ownership.ts`, and
`lib/public-workspace.ts` as managed files. If a product customizes public
paths, it must not claim Core canonical app paths or system/static paths.

Development hostname behavior is also centralized there: use `localhost` for
simple local work and `<private-ip>.nip.io` forms when testing root, app, or
Workspace host semantics. Keep nip.io separate from ngrok tunnels and do not
persist nip.io aliases as customer domains.

The schema compatibility coordinate remains Core `2.0`; this capability adds
the workspace-owned `public_sites` surface and extends `workspace_domains`
with the canonical site, hostname, type, and primary-domain coordinates. It
does not add a product-entity table or change migration ownership. Domain
provider reconciliation remains in the existing management workflow, while
products consume Core's typed domain service and `resolveHost()` contract.

## UI changes

Preserve source-derived implementations when moving shared components. A
small import/type diff is preferred. Check pending action sizing, focus
restoration, Escape/outside dismissal, portal theme, sidebar persistence,
mobile Sheet behavior, safe areas, reduced motion, and 390px overflow before
merging an update.

## Release discipline

Create a local checkpoint commit for each coherent phase. The canonical
release gate is `pnpm release:check`; tag `saas-core-vX.Y.Z` only after it
passes. The release workflow derives `X.Y.Z` from the tag, validates the
package coordinates, packs and inspects all five artifacts, then publishes in
dependency-safe order through either the one-time first-release `NPM_TOKEN`
bootstrap or npm Trusted Publishing with OIDC. npm may accept a publish before
the version appears in registry reads, so the publisher waits for visibility
and exact artifact integrity within a bounded timeout; reruns recognize an
already accepted immutable version and verify it instead of republishing it.
It verifies fresh registry installation and creates the GitHub Release only
afterward. Any failed gate stops before publication. Delete `NPM_TOKEN` after
the first successful bootstrap and configure Trusted Publishers for all five
packages. The `2.4.0`
evidence remains the prior release baseline; the coordinated `2.6.0` boundary added
target-plan downgrade eligibility and confirmation-time revalidation while
retaining the controlled legacy-consumer upgrade, packed exports, managed
billing/plan-catalog delivery, product-owned preservation, relocation, and a
second frozen install/build. The current `2.6.2` patch also carries the Checkout-session expiry, terminal Stripe status, and scheduled-downgrade runtime fixes described in `RELEASE-2.6.2.md`. The final release should include
`pnpm install --frozen-lockfile`, lint, typecheck, unit tests, clean DB tests,
browser tests, build, `pnpm pack`, a fresh consumer, relocation, and a second
frozen install/build.

If a first npm publication is interrupted, rerun the same tag workflow after
fixing the cause. The registry preflight compares each local tarball with npm
`dist.integrity` (or legacy `dist.shasum`) and skips only exact verified
packages; mismatches and indeterminate registry responses fail closed.
