# SaaS Core 2.2.0 release

Status: certified for the repository-backed local release boundary. This
document records the coordinated runtime/package release and its evidence; it
does not imply package publication, deployment, push, merge, production
mutation, or a live payment rollout.

## Release coordinates

- Runtime and coordinated package version: `2.2.0`
- Core database schema: `2.0`
- Canonical application template: `packages/app/template`
- Package namespace: `@sapienx`
- Packages: Core contracts, config, UI, app template carrier, and CLI
- Controlled upgrade proof: legacy `2.1.0` consumer → `2.2.0`
- Historical baseline: `docs/RELEASE-2.0.md` remains the 2.0 release record

All five package manifests and the runtime metadata use `2.2.0`. The schema
stays at `2.0` because this release adds reusable provider-neutral billing
contracts, lifecycle and entitlement behavior, managed billing surfaces, and
package/lifecycle metadata without changing the Core database contract. The
2.0 baseline migration remains the schema boundary; product catalogs, prices,
usage metrics, and product migrations remain product-owned.

## What is certified

The release includes the generic billing contract and deterministic policy
helpers, provider normalization and signature boundaries, durable webhook and
mutation persistence, reconciliation, effective-plan and recovery behavior,
and server-confirmed plan transition feedback. Paddle remains behind the
managed server adapter. The browser and provider-neutral package do not call
Paddle directly.

The managed application template delivers the billing webhook and lifecycle
routes, plan actions and surfaces, billing persistence and reconciliation,
provider mapping, entitlement helpers, and the confirmed-success experience.
The CLI manifest records those Core-managed files and preserves product-owned
catalogs, styles, routes, migrations, and domain files. Modified managed files
block an update; an apply or validation failure restores the independent
backup.

The Agent Surface is included in the current package release as a generic,
no-tool-by-default WebMCP foundation. It adds no migration. Products still own
tool definitions, endpoints, authentication, Workspace authorization, and
domain execution.

## Validation evidence

The controlled lifecycle fixture proves a `2.1.0` → `2.2.0` runtime and package
movement while keeping schema `2.0`. It checks local-source provenance,
managed billing and Agent Surface additions, dry-run/apply parity, conflict
isolation, rollback, manifest/package coordinates, and product-owned file
preservation.

The packed consumer proof builds and packs all five packages, installs them
through a disposable local registry, checks packed billing and Agent Surface
exports, initializes a fresh consumer, upgrades a legacy consumer with the
managed billing files, and verifies that product-owned files survive. It then
relocates the consumer, removes its dependencies, and repeats a frozen install,
doctor, tests, and build. The proof does not write checkout paths, `file:`
dependencies, temporary tarball paths, or local registry URLs into the
consumer.

The focused billing, lifecycle, persistence, entitlement, UI, Agent Surface,
genericity, catalog, and schema-doctor checks provide the contract evidence.
Provider-dependent browser and local Supabase checks are conditional on an
isolated local Supabase project, service credentials, and an installed
Playwright browser; when unavailable, they are reported as skipped. A doctor
run without server-only schema credentials reports a warning rather than
claiming live schema verification. Existing full typecheck/build and generic
scan blockers remain documented in
[`BILLING-CERTIFICATION.md`](./BILLING-CERTIFICATION.md).

## Consumer readiness boundary

ReserveVia and PlaceDJ remain separate, read-only consumer migration
workstreams. This Core release does not migrate either checkout, provider
history, legacy custom-data, product catalog, production data, or product
routes. Their audited reference commits and required migration evidence remain
in [`BILLING-CERTIFICATION.md`](./BILLING-CERTIFICATION.md) and the checklists
in [`CONSUMER-FOLLOWUPS.md`](./CONSUMER-FOLLOWUPS.md).

Before a consumer can make a live migration decision, it must preserve its
provider IDs and history, map legacy custom-data values, define its own plans,
prices, limits, usage metrics, copy, routes, styles, and migrations, resolve
managed conflicts, run sandbox lifecycle and webhook fixtures, prove rollback
and relocation, and capture its own browser and production-readiness evidence.
Neither consumer is certified by this package release.

## Safety boundary

This release makes no live Paddle request, provider mutation, production
database write, deploy, push, merge, secret change, destructive reset, schema
migration, lockfile publication, or consumer-domain change. Core remains the
generic workspace and billing boundary; products retain ownership of their
domain entities, catalogs, styles, routes, navigation, copy, usage writes, and
migrations.
