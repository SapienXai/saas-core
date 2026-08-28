# Product integration

SaaS Core supplies the identity, tenancy, security, billing, and application
surface. A product supplies the domain that lives inside a Workspace.

## Minimum product contract

Every product should provide:

1. a product configuration with name, slug, mark/icon, theme, metadata,
   optional shell extensions, and enabled Core capabilities;
2. product migrations whose tenant-owned tables include `workspace_id`;
3. server actions and route handlers that call Core authorization before any
   product read or write;
4. product-owned navigation and dashboard composition;
5. product tests for its own workflows and RLS policies.

`lib/product-config.ts` is the current default boundary. The product may
replace this module at its application boundary. It must not scatter identity
constants through Core components or server modules.

The optional `onboarding.productSetupPath` is the product handoff after Core
has created the first Workspace. It must be an internal path; omitted or
invalid values resolve to `/app`. Core onboarding itself owns only Account,
Workspace, membership, and the atomic initial subscription setup. An invited
member can accept access without being forced through owner onboarding.

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

Core reserves `/app`, `/app/team`, `/app/plan`, `/app/domains`, `/app/pwa`,
`/app/settings`, and `/app/setup` (including descendants). Product home and
navigation paths must be safe internal `/app/*` paths and cannot claim these
reserved areas. The shell field is optional so products generated before this
extension continue to compile, update, and retain their product config.

## Adding a domain

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
update, delete, role, and service-role policies deliberately for each domain.

## Extending the application

Product routes can live beside `/app` and use the same `ManageShell`, or a
product can compose a shell extension inside the main scroll-owned surface.
The default sidebar is configured in `components/manage/manage-sidebar.tsx`;
future packaging should make its navigation input replaceable without
changing collapse, Sheet, tooltip, persistence, or mobile behavior.

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

Core continues to own authentication, Workspace membership, billing
enforcement, platform operator access, outbox delivery, PWA safety, and the
generic interaction foundation.

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
