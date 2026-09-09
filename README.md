# SaaS Core 2.2

SaaS Core is infrastructure for workspace-based products. This repository is
a clean extraction from the production ReserveVia foundations: the proven
authentication, management shell, workspace boundary, billing, domains, PWA,
operator control plane, and interaction system remain; the restaurant and
reservation product domain does not.

The current Core runtime and coordinated package release is `2.2.0`. The Core
schema compatibility coordinate remains `2.0`, and this release delivers the
additive, Core-managed migration source
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` in the
repository and canonical application template. Package packing and the CLI
deliver that source to consumers; `init` and `update` never execute SQL. Each
consumer owns the controlled apply and verification workstream. The release
boundary and its validation evidence are recorded in
[docs/RELEASE-2.2.md](docs/RELEASE-2.2.md).

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
- Generic Agent Surface infrastructure: validated tool contracts, page-scoped
  WebMCP registration, cancellation, confirmation, observability hooks, and
  same-origin endpoint helpers. Products add all callable capabilities.
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
/platform/domains   /platform/health /platform/audit
```

The `/manage` routes remain compatibility aliases for the extracted
management application. The former `/platform/attention` and
`/platform/overrides` paths remain guarded compatibility routes when a product
still links to them, but they are not advertised in the default navigation.
There are no product-domain routes in Core.

The public root always offers `Sign in` and `Create account`. An authenticated
account is routed to `/app` or `/onboarding`; an explicit platform member with
no Workspace is routed to Platform Control. Signup confirmation names the
destination email. A local-only Mailpit link appears after signup in
development and is never rendered in production.

## Public Workspace Routing

Core provides one product-neutral public routing boundary:

```text
request
  → trusted hostname
  → Core hostname classification
  → public Workspace
  → normalized pathname
  → product-owned entity/page
```

Both `felix.placedj.com/beach` and a verified custom domain such as
`music.felixrestaurants.com/beach` can resolve the same Workspace. Core returns
the Workspace context and `/beach` as a pathname; it does not know what
“beach” represents. The hostname is the tenant authority. Query parameters and
path segments cannot select another Workspace.

Tenant and custom-domain requests to canonical Core paths such as `/app/*`,
`/manage`, `/platform`, `/login`, and `/onboarding` redirect to the configured
canonical app origin. Core/system paths such as `/api`, `/_next`, the manifest,
PWA endpoints, and static assets are reserved. Other paths remain product-owned
public paths. Public resolution reads persisted Workspace/domain state only; it
does not call Vercel, DNS, or another provider during page rendering.

Simple local development remains available through `localhost`, raw loopback/
LAN addresses, and `*.localhost`; those hosts retain `LOCAL_DEVELOPMENT`
semantics. When hostname-aware routing should mirror production, use the
supported dotted IPv4 `nip.io` forms:

```text
http://127.0.0.1.nip.io:<port>
http://app.127.0.0.1.nip.io:<port>
http://demo.127.0.0.1.nip.io:<port>

http://192.168.1.108.nip.io:<port>
http://app.192.168.1.108.nip.io:<port>
http://demo.192.168.1.108.nip.io:<port>
```

Core classifies these as development equivalents of the configured root,
application, and hosted Workspace hosts. The embedded address must be a
loopback or private IPv4; arbitrary `something.nip.io` hosts are not trusted
and nip.io hosts cannot be registered as customer domains. `nip.io` provides
DNS mapping only; it is not a tunnel and does not expose the machine publicly.
Public-host tests do not require live nip.io DNS.

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
- [Agent Surface](docs/AGENT-SURFACE.md)
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

The additive, provider-neutral billing persistence source is
`supabase/migrations/20260909094344_reusable_billing_persistence.sql`. It is
Core-managed and is shipped from the repository root and
`packages/app/template`; `@sapienx/saas-core-app` and the packed CLI carry it
through `init` and `update`. Those commands copy and hash the source for the
consumer manifest but never apply SQL. A consumer must run its own controlled
migration process and verify the result. Product-owned migrations under
`supabase/migrations/product/**` remain outside the managed set and survive
Core updates.

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
optional shell extensions, enabled Core capabilities, product plan catalog,
and usage metric definitions. The generated `product.catalog.json` is the canonical
product-owned catalog source; the TypeScript boundary imports it rather than
duplicating plan data. Core owns the billing lifecycle and keyed entitlement
engine; products own plan names, prices, feature catalog, limits, and
marketing copy. Synchronize a catalog server-side with `pnpm
billing:sync-catalog -- product.catalog.json`; the command validates and
persists the explicit active default plan atomically.

Fresh products receive a neutral, zero-price development catalog with one
`default` plan. It is deliberately product-owned and may be replaced without
changing the Core schema or the Core-managed migration source. Its default plan
explicitly includes
`limits.core.workspaces: 1`; `null` means intentional unlimited capacity.
Catalog synchronization persists `defaultPlanKey` in private Core settings and
rejects a missing, inactive, or structurally incomplete default. Workspace
creation uses that configured key, completes Core onboarding atomically, and
does not change existing subscriptions when the default changes.

After Core onboarding, a product may hand off to an internal product route with
`PRODUCT_CONFIG.onboarding.productSetupPath`; the safe default is `/app`.
Manual Workspace provisioning remains the default. A product whose first
meaningful setup action should create its own resource may explicitly opt into
`workspaceProvisioning: "deferred"`. In that mode, an authenticated user with
no Workspace is sent to the product setup route, and the product calls the
generic server-side `ensureInitialWorkspace({ nameHint })` capability when the
first action is submitted. Core reuses an existing membership, enforces the
configured Workspace limit, creates the owner membership, and generates a
unique Workspace slug; it never receives or models the product resource.
Core does not know the product’s domain or commercial plan names. Account,
Workspace, Platform, and Product concerns remain separate, and Workspace roles
do not imply Platform roles.

The optional shell extension keeps the application presentation product-owned
without forking the management shell:

```ts
shell: {
  homePath: "/app/projects",
  homeLabel: "Projects",
  navigation: [{ key: "projects", label: "Projects", href: "/app/projects", icon: "folder", match: "prefix" }],
}
```

`/app` redirects to that safe internal home when configured; without it, the
existing Core Workspace dashboard remains unchanged. Navigation is shared by
the desktop sidebar, collapsed rail, and mobile Sheet. Core reserves `/app`,
`/app/team`, `/app/plan`, `/app/domains`, `/app/pwa`, `/app/settings`, and
`/app/setup`; product navigation never replaces authorization.

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

`doctor` reports Core source readiness, consumer presence and hash readiness,
and manifest ownership/readiness as separate checks. It verifies actual `2.0`
schema metadata only when server-only Supabase credentials are available;
without those credentials the database check is a warning, while missing or
changed migration source, consumer, or manifest state is an error. `update`
plans completely before mutation, blocks on modified managed files, creates a
self-contained backup, validates, and rolls back the consumer automatically if
apply or validation fails. Rollback restores metadata and replaced files and
removes newly added Core files, including the billing migration. The controlled
`2.1.0` → `2.2.0` consumer proof covers packed exports, managed billing delivery,
product-owned preservation, relocation, and a second frozen install/build.

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
