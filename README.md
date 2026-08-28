# SaaS Core 2.0

SaaS Core is infrastructure for workspace-based products. This repository is
a clean extraction from the production ReserveVia foundations: the proven
authentication, management shell, workspace boundary, billing, domains, PWA,
operator control plane, and interaction system remain; the restaurant and
reservation product domain does not.

The governing model is:

```text
SaaS Core
└── Workspace
    └── product-owned domain records with workspace_id
```

Core owns the workspace boundary and the quality of the application surface.
A product owns its entities, workflows, routes, navigation entries, copy, and
domain migrations. Product code must not weaken Core authorization, RLS,
billing validation, email delivery, or service-role boundaries.

## What is included

- Supabase SSR authentication: signup, login, logout, confirmation, recovery,
  safe redirects, and invitation entry.
- Workspace creation, selection, switching, membership, roles, invitations,
  settings, setup, and entitlement-aware limits.
- Plans, subscriptions, usage periods, Paddle webhook/reconciliation
  boundaries, cancellation feedback, and platform overrides.
- Generic email outbox/delivery, retry and provider webhook infrastructure;
  Web Push subscription and delivery infrastructure.
- Installable management PWA, safe service-worker shell caching, push wiring,
  safe-area handling, and workspace-scoped branding.
- Custom workspace domains with provider verification/reconciliation.
- Platform Control for workspaces, users, plans, domains, audit, health,
  attention, and controlled overrides.
- ReserveVia-derived responsive management shell, collapsed sidebar, mobile
  drawer, workspace switcher, account controls, theme persistence, Radix
  overlays, keyboard/focus behavior, loading states, toasts, and feedback.

The portable package boundary is intentionally small: `@sapienx/saas-core-app`
carries the canonical source-derived application template, while
`@sapienx/saas-core`, `@sapienx/saas-core-config`, `@sapienx/saas-core-ui`, and
`@sapienx/saas-core-cli` carry real contracts, source-derived UI
implementation, and lifecycle tooling. `saas-core init` materializes the full
template, not a placeholder shell.

## Routes

Public/auth infrastructure is intentionally small:

```text
/                    entry surface
/login               sign in
/signup              create account
/forgot-password     request recovery
/reset-password      choose a new password
/onboarding          resumable workspace setup
/onboarding/workspace create another workspace (when entitled)

/app                 workspace dashboard
/app/team            membership and invitations
/app/plan            plan, usage, and billing
/app/setup           setup status
/app/settings        workspace settings
/app/domains         custom workspace domain
/app/pwa             PWA and push settings

/platform            operator overview
/platform/workspaces /platform/users /platform/billing
/platform/domains   /platform/health /platform/attention
/platform/audit     /platform/overrides
```

The `/manage` routes remain compatibility aliases for the extracted
management application. There are no product-domain routes in Core.

The public root always offers `Sign in` and `Create account`. An authenticated
account is routed to `/app` or `/onboarding`; an explicit platform member with
no Workspace is routed to Platform Control. Signup confirmation names the
destination email. A local-only Mailpit link appears after signup in
development and is never rendered in production.

## Source boundary

The extraction record in [docs/RESERVEVIA-EXTRACTION.md](docs/RESERVEVIA-EXTRACTION.md)
classifies source areas as Core, Product, Mixed, Infrastructure, Development,
or Unknown and records why each changed. Source-derived UI was copied and
trimmed surgically. Restaurant-specific public pages, business workflows,
reports, lead ingestion, reservation notifications, and their database
objects were removed rather than generalized into fake Core concepts.

Read the implementation contract in:

- [Architecture](docs/ARCHITECTURE.md)
- [Product integration](docs/PRODUCT-INTEGRATION.md)
- [UI system](docs/UI-SYSTEM.md)
- [Security](docs/SECURITY.md)
- [Upgrading](docs/UPGRADING.md)

## Database

`supabase/migrations/20260827204359_saas_core_v2_baseline.sql` is a clean
SaaS Core 2.0 baseline. It is independent of the ReserveVia migration stream
and contains only workspace, membership, invitation, plan, subscription,
usage, domain, PWA, push, platform, audit, and email infrastructure. The
baseline also owns private schema metadata and a server-controlled product
default-plan setting. `bootstrap_initial_workspace` never guesses a plan from
sort order; catalog synchronization must first persist an explicit active
`defaultPlanKey`.

Every public Core table has RLS enabled. Workspace access is expressed through
membership predicates; platform and delivery tables are server-only. Product
migrations must add an intentional `workspace_id` boundary and their own
policies.

```bash
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:reset
pnpm db:test:clean
```

The local Supabase project uses ports `55620`–`55628`, isolated from any other
checkout. `db:test:clean` resets it and runs the authenticated workspace/RLS
suite.

## Development and verification

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm db:test:schema
pnpm core:doctor-schema
pnpm core:catalog
pnpm core:scan
pnpm build
pnpm dev:local
pnpm e2e:critical
```

The browser configuration checks the public entry/auth surfaces at desktop and
mobile sizes. Provider-dependent billing, email, push, and domain operations
remain guarded by their server-only environment variables and are never
silently replaced with fixtures.

## Product integration

A product config is the identity and commercial boundary for the default
surface: `lib/product-config.ts` provides name, slug, mark, theme, metadata,
navigation, enabled Core capabilities, product plan catalog, and usage metric
definitions. The generated `product.catalog.json` is the canonical
product-owned catalog source; the TypeScript boundary imports it rather than
duplicating plan data. Core owns the billing lifecycle and keyed entitlement
engine; products own plan names, prices, feature catalog, limits, and
marketing copy. Synchronize a catalog server-side with `pnpm
billing:sync-catalog -- product.catalog.json`; the command validates and
persists the explicit active default plan atomically.

Fresh products receive a neutral, zero-price development catalog with one
`default` plan. It is deliberately product-owned and may be replaced without
a Core migration. Its default plan explicitly includes
`limits.core.workspaces: 1`; `null` means intentional unlimited capacity.
Catalog synchronization persists `defaultPlanKey` in private Core settings and
rejects a missing, inactive, or structurally incomplete default. Workspace
creation uses that configured key, completes Core onboarding atomically, and
does not change existing subscriptions when the default changes.

After Core onboarding, a product may hand off to an internal product route with
`PRODUCT_CONFIG.onboarding.productSetupPath`; the safe default is `/app`.
Core does not know the product’s domain or commercial plan names. Account,
Workspace, Platform, and Product concerns remain separate, and Workspace roles
do not imply Platform roles.

The lifecycle commands are deliberately portable and manifest-based:

```bash
pnpm pack
pnpm init -- my-product ./my-product
pnpm doctor -- ./my-product
pnpm diff -- ./my-product
pnpm update -- ./my-product
```

They do not write `file:` dependencies, absolute checkout paths, temporary
tarball paths, or local registry URLs into generated products. The generated
consumer proof uses a clearly non-domain-specific Projects fixture.

`doctor` verifies manifest, package, ownership, catalog, portability, and—when
server-only Supabase credentials are available—the actual `2.0` Core schema
metadata. Without those credentials it reports a warning rather than claiming
verification. `update` plans completely before mutation, blocks on modified
managed files, creates a self-contained backup, validates, and rolls back the
consumer automatically if apply or validation fails.

Generated consumers use `@sapienx/saas-core`, `@sapienx/saas-core-config`, and
`@sapienx/saas-core-ui` at runtime. The CLI is a devDependency, and
`@sapienx/saas-core-app` is the package-only template carrier used while
materializing the canonical app.

## Security posture

Authorization is server-side and duplicated by database policy where data is
tenant-scoped. Platform operations require platform membership. Service-role
clients are imported only from server-only modules and no privileged key is
exposed through `NEXT_PUBLIC_*` configuration or client components. Webhook
signatures, redirect targets, provider credentials, and delivery retries are
validated at their infrastructure boundary.

This repository is infrastructure, not an end-user brand or a marketing site.
