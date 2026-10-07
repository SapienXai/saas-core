# Product integration

SaaS Core supplies the identity, tenancy, security, billing, public-domain,
and application surface. A product supplies the product domain that lives
inside a Workspace and consumes Core's public-domain mapping.

## Minimum product contract

Every product should provide:

1. a product configuration with name, slug, mark/icon, theme, metadata,
   optional shell extensions, and enabled Core capabilities;
2. flat, timestamped product migrations under `supabase/migrations/` whose
   tenant-owned tables include `workspace_id`;
3. server actions and route handlers that call Core authorization before any
   product read or write;
4. product-owned navigation and dashboard composition;
5. product tests for its own workflows and RLS policies.

Product migration ownership is explicit but separate from Supabase execution
ordering. Every exact migration path shipped by the Core template and recorded
as managed in the consumer manifest is Core-owned. A migration created by the
product at another flat path is Product-owned, remains outside the Core
managed hash set, and is preserved by `saas-core update`. Core does not infer
ownership from a filename, timestamp, SQL contents or product vocabulary. The
legacy `supabase/migrations/product/` namespace is preserved for existing
consumers, but new migrations should use the flat native directory so normal
`supabase db reset`/apply commands execute them.

Flat means a direct-child SQL file only: `supabase/migrations/<filename>.sql`.
Arbitrary nested paths such as `supabase/migrations/foo/bar.sql` are
noncanonical; Core preserves them and reports a warning, but does not claim
that the normal Supabase migration flow will execute them. Non-SQL files in
the migration directory are not migrations.

`lib/product-config.ts` is the current default boundary. The product may
replace this module at its application boundary. It must not scatter identity
constants through Core components or server modules.

## Content security policy extensions

Core owns the default response security headers. A product may extend only the
`frame-src` directive through the optional product-owned
`src/product/security-config.json` file. It accepts exact HTTPS origins and
does not replace the rest of the Core policy:

```json
{
  "contentSecurityPolicy": {
    "frameSrc": ["https://video.example"]
  }
}
```

The file is read by the Next.js config at build time. Invalid JSON, non-HTTPS
values, wildcards, paths, credentials, or other non-origin values fail the
build so malformed input cannot silently weaken the policy. Keep vendor
origins limited to the frames the product actually embeds.

## Ownership and dependency direction

Classify a requested change before editing a consumer:

- **Core:** reusable platform capability or generic implementation that would
  still make sense for another product;
- **Product:** domain behavior, product data, copy, assets or composition that
  only has meaning inside one product;
- **Integration:** the product-side configuration and consumption of a Core
  capability.

Use this test: would the request still make sense if this product did not
exist? If yes, it belongs in Core. If the product needs a capability Core does
 not expose, add the generic capability to Core first, then configure and
 consume it in the product. Keep the direction `SaaS Core → Products → product
 domain` and never duplicate generic implementations in both repositories.

The optional `onboarding.productSetupPath` is the product handoff after Core
has created the first Workspace. It must be an internal path; omitted or
invalid values resolve to `/app`. Manual Workspace provisioning remains the
default. A product can explicitly set
`onboarding.workspaceProvisioning` to `"deferred"` when its first meaningful
product setup action should trigger Workspace creation. Core then exposes the
server-only `ensureInitialWorkspace({ nameHint })` capability: it accepts only
a generic display-name hint, reuses an authorized existing membership, and
otherwise performs the normal plan-limited Workspace and owner-membership
bootstrap with database-owned unique slug generation. The product resource is
created by product code after the helper returns; Core never names or stores
that resource. The operation is serialized per account so retries cannot create
another initial Workspace. An invited member is reused rather than provisioned
an unnecessary Workspace and still needs the product's own write permission.
Core onboarding itself owns only Account, Workspace, membership, and the atomic
initial subscription setup. An invited member can accept access without being
forced through owner onboarding.

The commercial catalog is product-owned too. A product can define any plan
keys, prices, feature keys, and usage metric keys; Core does not require a
particular catalog or a universal business metric. Synchronize it through the
server-only, idempotent bootstrap command:

```bash
pnpm billing:sync-catalog -- ./product.catalog.json
pnpm billing:sync-catalog -- ./product.catalog.json --dry-run
```

`product.catalog.json` is the single catalog source at the application
boundary. Catalog sync updates plan metadata and keyed limits, persists the
explicit active `defaultPlanKey` in Core configuration, preserves existing
provider price IDs, and only deactivates plans when `--deactivate-missing` is
explicit. It is atomic and safe to rerun. Changing the default affects future
workspace bootstrap only; existing subscriptions are unchanged.

`saas-core init` creates a neutral product-owned starter catalog so a new local
product can bootstrap a Workspace immediately after its catalog is seeded. It
contains one unpriced `default` plan with an explicit
`limits.core.workspaces: 1` development limit. `null` is the explicit
unlimited value. It does not add Core pricing assumptions or require a schema
migration. Catalog synchronization persists the configured default server-side
and leaves existing subscriptions unchanged when a product changes it.

## Product shell extensions

The optional `PRODUCT_CONFIG.shell` field is the small presentation boundary
for a product-owned workspace home and first-level navigation. It does not
replace `ManageShell`, change its desktop/collapsed/mobile composition, or
grant access to a route. A product page remains responsible for server-side
authorization and its own RLS policies.

```ts
shell: {
  homePath: "/app/projects",
  homeLabel: "Projects",
  navigation: [
    { key: "projects", label: "Projects", href: "/app/projects", icon: "folder", match: "prefix" },
    { key: "reports", label: "Reports", href: "/app/reports", icon: "bar-chart", requiredFeature: "reports" },
  ],
}
```

Product routes can be placed under `app/(product)/app/*`. When `homePath` is
configured, `/app` redirects to it; when omitted, `/app` continues to render
the Core Workspace dashboard. Navigation entries are normalized in one Core
resolver and feed the expanded sidebar, collapsed rail, and mobile Sheet.
Unknown icons safely use the generic layers icon. Optional role and feature
filters only hide navigation affordances; they are never authorization.

## Platform workspace details extension

The Core-managed `/platform/workspaces` collection exposes an optional
server-only `src/product/platform-admin.ts` extension. Core owns platform
authorization and the list shell; a product may return safe summaries and
child records keyed by Workspace ID for its own domain resources. The
extension is called only after the Core page has authorized the platform
operator, and the CLI scaffolds the neutral extension for new and updated
consumers. Products must keep service-role access and any product-specific
queries inside that extension.

Core reserves `/app`, `/app/team`, `/app/plan`, `/app/domains`, `/app/pwa`,
`/app/settings`, and `/app/setup` (including descendants). Product home and
navigation paths must be safe internal `/app/*` paths and cannot claim these
reserved areas. The shell field is optional so products generated before this
extension continue to compile, update, and retain their product config.

## Global product theme boundary

The application root loads the styles in this order:

```text
styles/globals.css       Core-managed primitives/tokens
styles/core-lilac.css    Core-managed auth and management behavior/tokens
styles/product-theme.css Product-owned global token overrides
```

`styles/product-theme.css` is intentionally small and token-oriented. It is
loaded by the root layout, so a product can brand `/login`, `/signup`,
password recovery/reset, onboarding and management surfaces without editing
`components/auth/**`, `components/manage/**` or `styles/core-lilac.css`.
`styles/product.css` remains the product-owned route/domain stylesheet for
selectors that should only affect product pages. Products must override
documented Core variables rather than copy the Core stylesheet; Core’s empty
starter theme preserves the default palette when no customization is needed.

The optional `PRODUCT_CONFIG.auth.backgroundUrl` field adds one reusable auth
surface without allowing product code into the Core auth implementation:

```ts
auth: { backgroundUrl: "https://media.example.com/venue-screen" },
```

Core accepts HTTPS URLs only and renders the media surface behind auth forms
with no pointer or keyboard interaction capture. Products own the URL and any
palette overrides in `styles/product-theme.css`; reduced-motion mode hides
the external media surface while keeping the auth flow available.

## Adding a product table

```sql
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy projects_member_read on public.projects
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
```

The example is intentionally unrelated to any specific industry. Product
tables must not rely on UI filtering as tenancy protection. Add insert,
update, delete, role, and service-role policies deliberately for each product
resource. Public hostname ownership remains in Core.

## Public Workspace Routing

The public product boundary is intentionally small:

```text
SaaS Core: hostname → Domain → PublicSite → Workspace → productKey
Product:   resolved (workspaceId, siteId, productKey) + pathname → product renderer
```

A product can resolve a server request with the Core helper and then interpret
the result in its own domain code:

```ts
const result = await resolvePublicWorkspaceRequest(request)
if (result.status === "not_found" || result.status === "not_public_workspace") {
  notFound()
}
if (result.status === "unavailable") {
  throw new Error("Public Workspace routing is temporarily unavailable")
}

const { workspaceId, siteId, productKey, workspaceSlug, pathname } = result.context
// Product-owned: resolve (workspaceId, pathname) in the product domain.
// Product-owned: use productKey to select the public renderer; do not query
// workspace_domains directly.
```

The same context contract supports a hosted Workspace URL such as
`felix.placedj.com/beach` and a verified custom domain such as
`music.felixrestaurants.com/beach`. “Beach” is an example only; Core does not
know what it represents. The hostname is the only public tenant authority.
Neither a query parameter (`?workspace=...`) nor a path segment can switch the
Workspace, and the query string is not included in `pathname`.

Hosted resolution requires an exact active Core `Domain` row of type
`platform_subdomain`; it does not fall back to the Workspace slug. Custom
resolution requires the exact persisted `workspace_domains` record to be
active, production-configured, verified, provider-verified, DNS-configured,
and stamped with `verified_at`, plus the same active Workspace check. Both
records resolve through their `public_sites` row and return `siteId` and
`productKey`. A successful lookup with no eligible Workspace, site, or domain
returns `not_found`, which the product can render as a normal public 404. A
persistence or service failure returns `unavailable`; it must flow through
application error handling rather than being presented as a missing Workspace.
The public result is still generic and fail-closed, with no database details
exposed. Public rendering does not call Vercel, DNS, or any domain provider;
the domain-management workflow is responsible for reconciliation.

Core canonical app paths (`/app/*`, `/manage`, `/platform`, `/login`,
`/signup`, `/onboarding`, `/auth`, `/invite`, `/setup`, and related descendants)
cannot be product public paths on a tenant/custom host. They redirect to the
configured app origin with their query preserved. Core reserved public/system
paths (`/api`, `/_next`, manifest, PWA, sitemap, robots, OpenAPI, service
worker, and static assets) are protected but are not treated as app-origin
redirects. All other paths are product-owned, including `/`.

For simple local development, `localhost`, raw loopback/LAN addresses, and
`*.localhost` retain `LOCAL_DEVELOPMENT` semantics. For production-like
hostname testing, use a supported dotted IPv4 nip.io root:
`<workspace>.<private-ip>.nip.io` is classified as `HOSTED_WORKSPACE` with the
leading label as its slug, while `<private-ip>.nip.io` and
`app.<private-ip>.nip.io` are the root and canonical app equivalents. The
embedded address must be loopback or private IPv4; arbitrary nip.io hosts are
not trusted or valid customer domains. nip.io is DNS mapping only, not a
tunnel, and tests do not require live DNS.

## Extending the application

Product routes can live beside `/app` and use the same `ManageShell`, or a
product can compose a shell extension inside the main scroll-owned surface.
The shared `ManageShell` consumes the product-owned `PRODUCT_CONFIG.shell`
contract for the product home and first-level navigation. Its expanded
sidebar, collapsed rail, and mobile Sheet share that input while preserving
collapse, Sheet, tooltip, persistence, and mobile behavior.

Use the existing `components/ui` primitives and `sonner` feedback patterns.
Do not replace Radix overlays, pending buttons, focus-visible styles, theme
handling, or responsive transforms with simpler controls merely to add a
domain screen.

## Product-owned presentation

Products may customize:

- logo, icon, colors, type, and public metadata;
- navigation labels and product routes;
- dashboard cards and product-specific empty/loading states;
- product CSS and domain-specific responsive views;
- email and notification templates that call Core delivery infrastructure.

The manifest must list `styles/product-theme.css` as product-owned alongside
`styles/product.css`. The Core updater preserves both paths and never silently
turns a product theme into a managed fork.

Core continues to own authentication, Workspace membership, billing
enforcement, platform operator access, outbox delivery, PWA safety, and the
generic interaction foundation.

## Agent Surface

Agent tools are product-owned capabilities mounted on the page where their
context is valid. Import `defineAgentTool` from `@sapienx/saas-core`, define
one JSON Schema-backed contract per capability, and render the managed
`CoreWebMcpTools` component with that page’s tools. Core handles
`document.modelContext` feature detection, standard WebMCP annotations,
registration cleanup, duplicate-name protection, confirmation, and
`AbortSignal` forwarding. A browser without WebMCP remains a normal usable
browser page.

Products must declare `returnsUntrustedContent` explicitly, keep mutations
behind `requiresConfirmation` when appropriate, and enforce authentication,
Workspace authorization, role, entitlement, and input validation in product
execution code. For product-owned HTTP endpoints, the managed server helper
`isSameOriginAgentRequest()` provides a fail-closed browser boundary. It is not
authentication or Workspace authorization.

Agent Surface is available after a Core update but exposes zero tools until a
product page opts in. It adds no product configuration requirement and no
database migration. See [Agent Surface](AGENT-SURFACE.md) for the full
contract.

For example, a Projects product can define a `projects` table with
`workspace_id`, its own RLS policy, a `projects` navigation entry, a product
page, and a `projects` usage meter. None of those require a Core migration;
they are product-owned extensions of the Workspace boundary.

## ReserveVia recomposition

The extraction is successful only if the source product remains believable as
a consumer:

```text
SaaS Core + restaurant/reservation domain = ReserveVia
SaaS Core + Projects domain              = reference consumer
SaaS Core + music/venue domain           = future product
```

This repository does not rewrite the live source application. The first proof
is the temporary Projects consumer generated by `pnpm init`. The CLI
materializes the packed Core app template, so the consumer receives the same
auth, Workspace, Team, Plan, Setup, Settings, PWA, domain, platform, and
interaction foundations before its product domain is added.
