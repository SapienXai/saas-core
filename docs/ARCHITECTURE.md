# Architecture

SaaS Core 2.0 is a source-preserving extraction of the production ReserveVia
platform boundary. The working application remains understandable, while
stable package and ownership boundaries make it updateable without turning the
product layer into a plugin framework.

## Ownership

Core owns:

- authenticated identity, SSR cookies, redirects, recovery, and invitations;
- Workspace, membership, roles, permissions, selection, and settings;
- plan/subscription lifecycle, keyed usage, entitlements, billing webhooks, and
  limits;
- email delivery/outbox, Web Push subscriptions, PWA shell behavior;
- custom Workspace domains, Platform Control, audit, setup, and health;
- the default responsive shell and its interaction primitives.

Product code owns business entities and workflows. A product may add routes,
dashboard cards, navigation, theme values, and product CSS. Its tables attach
to Core through an explicit `workspace_id` foreign key and enforce their own
RLS policies. The global product theme extension is
`styles/product-theme.css`; it is loaded after the managed Core styles and is
excluded from managed-file updates. Core never interprets a Workspace as a
venue, account type, or other product entity.

## Request and session flow

`proxy.ts` handles trusted-origin route boundaries. Server components and
actions call `lib/supabase/server.ts`, which persists Supabase SSR cookies.
`lib/auth-utils.ts` resolves the current user, platform membership, and
workspace memberships. `lib/authorization.ts` is the server-side permission
boundary; UI visibility is only a convenience and never the authorization
source.

Signup and confirmation end at resumable `/onboarding`. The transactional
`bootstrap_initial_workspace` RPC derives the user from `auth.uid()`, creates
the Workspace and owner membership, and resolves the active default plan from
the private Core setting written by catalog synchronization. It counts owner
memberships against that configured plan's `core.workspaces` entitlement;
`created_by` is audit metadata, not an authorization or one-workspace
constraint. The same RPC records `onboarding_completed_at`, so the initial
Core foundation is atomic. Existing Workspace members are never sent back
through owner onboarding, and additional Workspace creation is a distinct,
entitlement-checked flow. Invitation creation and acceptance use one-use token
hashes, email matching, expiry, and role validation.

The public entry distinguishes Account, Workspace, Platform, and Product. A
platform-only account is not assigned a synthetic Workspace administrator
role. `PLATFORM_OWNER_EMAIL` is resolved server-side into a discoverable
platform membership/readiness state; the configured identity is not exposed to
ordinary production users. Product setup is an internal handoff configured by
`PRODUCT_CONFIG.onboarding.productSetupPath`, defaulting safely to `/app`.

## Public Workspace Routing

Public routing stops at the Core tenancy boundary:

```text
HTTP request
  → trusted x-forwarded-host/Host boundary
  → classifyHostname()
  → Workspace lookup by hosted slug or verified custom-domain mapping
  → PublicWorkspaceContext { Workspace, normalized pathname }
  → product-owned pathname interpretation
```

SaaS Core owns `hostname → Workspace`. The product owns
`Workspace + pathname → product entity`. For example, `/beach` is only a
normalized product pathname; Core does not define whether it is a page or any
other product entity. Query parameters are not part of pathname identity and
cannot override the hostname-selected Workspace.

Hosted Workspace requests use an exact slug under the configured root domain
and require `workspaces.status = 'active'` plus
`workspaces.platform_status = 'active'`. Custom requests use an exact
`workspace_domains.hostname` mapping and require `status = 'active'`,
`provider_environment = 'production'`, `verification_state = 'verified'`,
`provider_verified = true`, `dns_configured = true`, and a non-null
`verified_at`, followed by the same active Workspace check. An ordinary miss
returns `not_found`; a database or service failure returns `unavailable`
without exposing internal error details. Platform, local, preview,
canonical-app, and reserved system surfaces return `not_public_workspace`.

`resolvePublicWorkspaceRequest()` is server-only and shares the trusted host
extraction boundary with `proxy.ts`. It performs no Vercel API, DNS, provider
refresh, or reconciliation call during page resolution. Domain management
continues to own provider reconciliation and only its persisted result is
consumed by the public resolver.

Development domains have one canonical parser in `lib/domains/hostname.ts`.
Simple `localhost`, raw loopback/LAN, and `*.localhost` hosts remain
`LOCAL_DEVELOPMENT`. Supported dotted IPv4 nip.io hosts mirror production
semantics without a second routing model:

```text
127.0.0.1.nip.io              → PLATFORM_ROOT
app.127.0.0.1.nip.io          → PLATFORM_APP
acme.127.0.0.1.nip.io         → HOSTED_WORKSPACE (slug: acme)
```

The same forms work for private LAN IPv4 addresses. The parser accepts only a
loopback/private embedded address and one optional leading label; arbitrary
`*.nip.io` hosts are rejected from the trusted request boundary and customer
domain normalization. nip.io is DNS mapping, not a tunnel; ngrok remains the
separate development-tunnel path. Tests use host strings directly and never
depend on live DNS.

Core route ownership distinguishes canonical app paths from reserved public
paths. A tenant/custom host requesting `/app`, `/app/team`, `/manage`,
`/platform`, `/login`, or another canonical app descendant is redirected to
`SAAS_CORE_APP_DOMAIN`, preserving the query string. On a supported nip.io
Workspace host, the redirect instead targets `app.<same-development-root>`,
preserving HTTP, the active port, pathname, and query string. Product-owned public paths
such as `/beach` are not redirected. Dot-segment normalization uses the
standard URL parser before these checks, so encoded/dot-segment traversal
cannot bypass `/app` ownership.

## Management composition

The default `/app` surface is composed from the extracted management shell:

```text
ManageShell
├── ManageSidebar (expanded, collapsed, mobile Sheet)
├── ManageHeader (workspace, notifications, account, install prompt)
└── scroll-owned main surface
    ├── workspace dashboard
    ├── Team / Plan / Setup / Settings / Domains / PWA
    └── product-owned home and first-level navigation extension points
```

`components/manage/manage-shell.tsx` and `manage-sidebar.tsx` retain the
source behavior for persistence, collapse, active navigation, keyboard and
focus semantics, mobile drawer, safe areas, theme, document locking, refresh,
and PWA installation. `components/ui` retains the Radix-backed primitives;
Core code does not replace them with native approximations.

The product shell contract is deliberately small. `lib/product-shell.ts`
normalizes an optional `PRODUCT_CONFIG.shell` into a safe home path and
first-level navigation model. The same model is rendered by all three sidebar
states and the header title. `/app` remains the Core dashboard by default or
redirects to a configured product-owned `/app/*` route. Core-reserved routes
cannot be claimed by products, and visibility filters are UX-only; route
authorization remains in Core/product server boundaries.

## Infrastructure boundaries

Paddle is a billing provider, not an entitlement authority. Signed webhook
events are stored idempotently and update local subscription state only after
validation. `lib/entitlements.ts` reads keyed `features`, `limits`, and
`workspace_usage_periods.usage`; Core never requires Free/Starter/Pro/Business,
prices, or an `activity` metric. Products synchronize their own plan catalog
with `pnpm billing:sync-catalog`, which is idempotent and never mutates
provider-price mappings.

Resend delivery is isolated behind `lib/email-delivery.ts` and the outbox
routes. Invitations and account communication are generic Core messages.
Product notification types may use the same delivery infrastructure without
adding product columns to Core tables.

The management PWA caches only the safe shell/static layer. It does not cache
workspace responses, authentication responses, billing, team data, or
product-domain data. The manifest and install prompt derive branding from the
product configuration and authorized Workspace settings.

## Lifecycle and packaging

The root runtime is the executable reference and `packages/app/template` is
the single canonical application template. `packages/core` contains real
generic contracts; `packages/config` contains product identity/catalog
contracts; `packages/ui` contains the source-derived reusable primitives; and
`packages/cli` ships the template at pack time. `scripts/core-*` provide
portable `pack`, `init`, `doctor`, `diff`, and `update` behavior based on a
managed-file manifest. `diff` and `update` can use an explicit local Core
repository/template through `--source`; this is a development override and
does not write checkout paths or local dependency URLs into a consumer. If the
source is a Git checkout, local init/update records the optional
`coreSourceCommit` SHA for provenance without recording the source path.

The controlled namespace is `@sapienx`: `@sapienx/saas-core`,
`@sapienx/saas-core-config`, `@sapienx/saas-core-ui`,
`@sapienx/saas-core-app`, and `@sapienx/saas-core-cli`. The app package is a
template carrier; generated consumers run with Core, config, and UI as
runtime dependencies and the CLI as tooling. A generated Projects consumer
receives the actual auth, Workspace, Team, Plan, Setup, Settings, PWA,
domains, Platform Control, and source-derived interaction surfaces. It has a
generic Workspace plus Projects model and does not require industry-specific
concepts to boot.

The current runtime is `2.2.0`; the Core schema compatibility coordinate
remains `2.0`. The release delivers the additive, Core-managed migration
source `supabase/migrations/20260909094344_reusable_billing_persistence.sql`
from the repository root and `packages/app/template`. Package packing and CLI
`init`/`update` carry that source to consumers and never execute SQL. Consumers
apply and verify it through their own controlled migration process. Schema
metadata lives in `private.core_schema_metadata` and is readable by the CLI
only through a service-role-only RPC; product catalog changes do not change the
schema compatibility coordinate.

## Agent Surface

Core includes a product-neutral Agent Surface foundation without registering
any product capabilities. `@sapienx/saas-core` owns `AgentToolDefinition`,
JSON Schema validation, explicit read/mutation and untrusted-content metadata,
confirmation semantics, and lifecycle event types. The managed application
template owns the client-only `CoreWebMcpTools` adapter and the server-only
`isSameOriginAgentRequest` helper.

Products opt in on individual pages and own the tool definitions, domain
execution, authentication, Workspace authorization, and any endpoint. The
adapter uses the current `document.modelContext` imperative WebMCP API when
available, forwards the WebMCP `AbortSignal`, and aborts registrations on
unmount. There is no universal Core agent endpoint, automatic registry,
database table, or remote MCP implementation. See
[Agent Surface](AGENT-SURFACE.md) for the contract and security boundary.
