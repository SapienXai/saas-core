# SaaS Core 2.3.0 release

This coordinated minor release delivers the reusable billing and entitlement
foundation introduced by Phase 1. The five Core packages, the managed
application template, and the CLI use the same `2.3.0` runtime coordinate;
Core schema compatibility remains `2.0`.

## Highlights

- The provider-neutral Core package exports typed entitlement evaluation,
  usage snapshots, and client-facing entitlement gate state.
- Effective plans fail closed to the configured Free plan when a paid local
  subscription is absent, incomplete, unmapped, cancelled, paused, or expired.
  Missing limits remain unavailable; only an explicit `null` limit is unlimited.
- Consumer-defined usage resolvers and the transactional
  `lock_workspace_entitlement` boundary are available for product-owned
  capabilities without adding product tables to Core.
- Structured server-side entitlement errors and reusable billing, usage, and
  limit-reached UI are included in the canonical application template.
- The CLI carries both Core-managed billing migration sources as source only;
  consumers still control SQL application and verification.

## Package versions

| Package | Version |
| --- | --- |
| `@sapienx/saas-core` | `2.3.0` |
| `@sapienx/saas-core-config` | `2.3.0` |
| `@sapienx/saas-core-ui` | `2.3.0` |
| `@sapienx/saas-core-app` | `2.3.0` |
| `@sapienx/saas-core-cli` | `2.3.0` |

## Schema and consumer delivery

The release is additive and keeps schema compatibility coordinate `2.0`. The
following sources are delivered from both the repository and the canonical
application template:

- `supabase/migrations/20260909094344_reusable_billing_persistence.sql`
- `supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`

Package packing and CLI `init`/`update` deliver migration source and metadata
only. The CLI never executes SQL; each consumer owns migration ordering,
application, verification, and rollback of its database state. Product-owned
catalogs, routes, styles, domain tables, and migrations remain outside the
managed replacement set.

## Lifecycle and compatibility

The normalized local subscription projection remains the billing boundary for
Paddle. Webhook signature verification, event ordering, duplicate delivery
handling, unknown price mapping, scheduled cancellation, and fail-closed
fallback behavior remain enforced by the existing server lifecycle.

The packed consumer proof covers the `2.2.0` → `2.3.0` managed update,
entitlement and billing file delivery, product-owned preservation, conflict
safety, rollback, relocation, and a second frozen install/build. No PlaceDJ or
ReserveVia integration is included in this release.

## Install

```bash
pnpm add @sapienx/saas-core@^2.3.0 @sapienx/saas-core-config@^2.3.0 @sapienx/saas-core-ui@^2.3.0
pnpm add -D @sapienx/saas-core-cli@^2.3.0
pnpm exec saas-core doctor .
pnpm exec saas-core diff . --json
pnpm exec saas-core update . --dry-run --json
pnpm exec saas-core update .
pnpm install
```

Consumers must define their own plan catalog, provider price mappings, domain
usage resolvers, and commercial limits before adopting product-specific
entitlements. This release does not define PlaceDJ limits or apply consumer
database migrations.
