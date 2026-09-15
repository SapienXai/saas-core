# `@sapienx/saas-core-app`

Current package release: `2.5.0`; Core schema compatibility coordinate remains
`2.0`. This package is the template carrier for the coordinated release and
includes the additive, Core-managed billing persistence, entitlement-lock, and
plan-catalog sources (stored under `template/` in this package).
The CLI delivers those sources to consumers during `init`/`update` and never
executes SQL; each consumer owns controlled application and verification.

This package carries the portable application template extracted from the
production management implementation. The CLI materializes its
`template/` into a new product so the consumer receives the actual Core app
shell, auth, workspace, team, plan, settings, PWA, domain, and platform
surfaces rather than a placeholder scaffold.

The template owns no product domain. Product code is added under the Workspace
boundary after initialization. It is consumed by the CLI as the one canonical
template source; generated products receive its source files and do not need
this package at runtime. Its `templateDependencies` field is packaging metadata
for the materialized application, not a runtime dependency list for this
template-carrier package.

The managed template carries the Core billing route and lifecycle projection,
workspace-scoped persistence and entitlement helpers, the plan and
confirmed-success surfaces, and the Core migration sources named above. Products
provide their own catalog, provider mapping, and domain usage writes while the
managed files retain authorization, webhook, recovery, and rollback behavior.
Product-owned migrations under `supabase/migrations/product/**` remain outside
the managed template update set and are preserved.

The template also carries the generated consumer contract: a dynamic
`README.md`, `AGENTS.md`, `.env.example`, lint/Vitest configuration, local type
generation and server-only catalog synchronization scripts. The CLI renders
the product name and slug during `init`. Consumer documentation, product
configuration, product migrations and generated `types/supabase.ts` are
product-owned after materialization.
