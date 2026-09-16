# SaaS Core 2.6.0 coordinated release boundary

The coordinated release uses runtime/package coordinate `2.6.0` and Core
schema compatibility coordinate `2.0`. The tag is the release anchor; verify
the exact source commit, package artifacts, and registry identity before
calling a build a public release.

## Highlights

- Adds the product-neutral Domain Foundation v1 contract:
  `Workspace → PublicSite(productKey) → Domain`.
- Adds the canonical additive migration
  `supabase/migrations/20260916120000_saas_core_domain_foundation_v1.sql`.
  The timestamp is intentionally distinct from product migrations and is the
  only current Core identity for this migration.
- Enforces global normalized-hostname uniqueness, one platform domain per
  public site, and one primary domain per public site at the database layer.
- Keeps domain management behind Core authorization/RLS and resolves only
  active domains belonging to active workspaces. Unknown, pending, failed,
  and otherwise inactive hosts fail closed.
- Exposes the typed domain contracts and the runtime `isCoreProductKey`
  validator from the package root.
- Includes the minimum blocker fixes: `447c67c` for the migration timestamp
  collision and `eb640ce` for the package runtime export boundary.

## Package versions

| Package | Version |
| --- | --- |
| `@sapienx/saas-core` | `2.6.0` |
| `@sapienx/saas-core-config` | `2.6.0` |
| `@sapienx/saas-core-ui` | `2.6.0` |
| `@sapienx/saas-core-app` | `2.6.0` |
| `@sapienx/saas-core-cli` | `2.6.0` |

## Schema and consumer delivery

The Domain Foundation is additive and keeps schema compatibility coordinate
`2.0`. Core packages and the CLI deliver migration source only; they never
execute a consumer migration. Consumers apply and verify the canonical
migration through their own controlled database workflow and preserve
product-owned migrations.

The model is deliberately product-neutral. A product key selects the renderer
for a workspace public site; it does not own the domain. Custom-domain
provider integrations, DNS verification/provisioning, certificates, redirects,
analytics, and billing for custom domains remain future work.

This release does not modify PlaceDJ, ReserveVia, product routes, public radio,
Explore, or venue UI. Products must consume the Core resolver and service
contract rather than creating independent hostname ownership tables.

## Scope

This document describes the coordinated `2.6.0` release boundary. It does not
publish, push, tag, deploy, or apply migrations by itself. Final release and
consumer acceptance evidence must come from the release workflow and the
published artifacts.
