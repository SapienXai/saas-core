# SaaS Core 2.4.0 release

This coordinated minor release makes the reusable Plan Catalog foundation
introduced by `2d89855bdd98e530f5c0518345e6f2dd790db1ea` available alongside the
existing billing, entitlement, and consumer lifecycle contracts. All five Core
packages, the managed application template, and the CLI use the same `2.4.0`
runtime coordinate; Core schema compatibility remains `2.0`.

## Highlights

- The provider-neutral Core package exports the typed Plan Catalog contract and
  validation, normalization, duplication, and change-classification helpers.
- Server-only Platform Billing actions manage stable plan keys, presentation
  metadata, entitlement maps, provider price mappings, archival, and safe
  history-preserving edits.
- The canonical application template and CLI carry the additive
  `20260914100000_reusable_plan_catalog_management.sql` source and its generated
  Supabase types without executing SQL.
- `docs/PLAN-CATALOG.md` is included in the published Core runtime package so
  consumers can define plans, provider mappings, usage resolvers, and mutation
  guards against the same public contract.
- The existing fail-closed subscription, entitlement, usage, Paddle lifecycle,
  and managed-file update behavior remains unchanged and is covered by the
  release gate.

## Package versions

| Package | Version |
| --- | --- |
| `@sapienx/saas-core` | `2.4.0` |
| `@sapienx/saas-core-config` | `2.4.0` |
| `@sapienx/saas-core-ui` | `2.4.0` |
| `@sapienx/saas-core-app` | `2.4.0` |
| `@sapienx/saas-core-cli` | `2.4.0` |

## Schema and consumer delivery

The release is additive and keeps schema compatibility coordinate `2.0`. The
following Core-managed sources are delivered from the repository and the
canonical application template:

- `supabase/migrations/20260909094344_reusable_billing_persistence.sql`
- `supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`
- `supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`

Package packing and CLI `init`/`update` deliver migration source and manifest
metadata only. The CLI never executes SQL; each consumer owns migration
ordering, application, verification, and rollback of its database state.
Product-owned catalogs, routes, styles, domain tables, and migrations remain
outside the managed replacement set.

## Lifecycle and compatibility

The normalized local subscription projection remains the billing boundary for
Paddle. Webhook signature verification, event ordering, duplicate delivery
handling, unknown price mapping, scheduled cancellation, and fail-closed
fallback behavior remain enforced by the existing server lifecycle.

The packed consumer proof covers the `2.2.0` → `2.4.0` managed update, the
Plan Catalog public exports, all three managed migration sources, product-owned
preservation, conflict safety, rollback, relocation, and a second frozen
install/build. No PlaceDJ or ReserveVia integration is included in this
release.

## Install

```bash
pnpm add @sapienx/saas-core@^2.4.0 @sapienx/saas-core-config@^2.4.0 @sapienx/saas-core-ui@^2.4.0
pnpm add -D @sapienx/saas-core-cli@^2.4.0
pnpm exec saas-core doctor .
pnpm exec saas-core diff . --json
pnpm exec saas-core update . --dry-run --json
pnpm exec saas-core update .
pnpm install
```

Consumers must define their own plan names, prices, provider mappings,
domain-specific usage resolvers, and commercial limits before adopting
product-specific entitlements. This release does not define PlaceDJ limits or
apply consumer database migrations.
