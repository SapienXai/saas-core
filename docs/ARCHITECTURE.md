# Architecture

SaaS Core 2.0 is a source-preserving extraction of the production ReserveVia
platform boundary. The monolith stays intentionally understandable while the
boundaries settle. Packaging is a lifecycle concern, not a reason to split
working server behavior into a plugin framework.

## Ownership

Core owns:

- authenticated identity, SSR cookies, redirects, recovery, and invitations;
- Workspace, membership, roles, permissions, selection, and settings;
- plans, subscriptions, usage, entitlements, billing webhooks, and limits;
- email delivery/outbox, Web Push subscriptions, PWA shell behavior;
- custom Workspace domains, Platform Control, audit, setup, and health;
- the default responsive shell and its interaction primitives.

Product code owns business entities and workflows. A product may add routes,
dashboard cards, navigation, theme values, and product CSS. Its tables attach
to Core through an explicit `workspace_id` foreign key and enforce their own
RLS policies. Core never interprets a Workspace as a venue, account type, or
other product entity.

## Request and session flow

`proxy.ts` handles trusted-origin route boundaries. Server components and
actions call `lib/supabase/server.ts`, which persists Supabase SSR cookies.
`lib/auth-utils.ts` resolves the current user, platform membership, and
workspace memberships. `lib/authorization.ts` is the server-side permission
boundary; UI visibility is only a convenience and never the authorization
source.

Signup and confirmation end at resumable `/onboarding`. The transactional
`bootstrap_initial_workspace` RPC derives the user from `auth.uid()`, creates
the Workspace and owner membership, and lets the database create the default
Free subscription. Invitation creation and acceptance use one-use token
hashes, email matching, expiry, and role validation.

## Management composition

The default `/app` surface is composed from the extracted management shell:

```text
ManageShell
├── ManageSidebar (expanded, collapsed, mobile Sheet)
├── ManageHeader (workspace, notifications, account, install prompt)
└── scroll-owned main surface
    ├── workspace dashboard
    ├── Team / Plan / Setup / Settings / Domains / PWA
    └── product-owned domain extension points
```

`components/manage/manage-shell.tsx` and `manage-sidebar.tsx` retain the
source behavior for persistence, collapse, active navigation, keyboard and
focus semantics, mobile drawer, safe areas, theme, document locking, refresh,
and PWA installation. `components/ui` retains the Radix-backed primitives;
Core code does not replace them with native approximations.

## Infrastructure boundaries

Paddle is a billing provider, not an entitlement authority. Signed webhook
events are stored idempotently and update local subscription state only after
validation. `lib/entitlements.ts` reads the database-backed plan and exposes
generic limits such as workspaces, users, activity, and history.

Resend delivery is isolated behind `lib/email-delivery.ts` and the outbox
routes. Invitations and account communication are generic Core messages.
Product notification types may use the same delivery infrastructure without
adding product columns to Core tables.

The management PWA caches only the safe shell/static layer. It does not cache
workspace responses, authentication responses, billing, team data, or
product-domain data. The manifest and install prompt derive branding from the
product configuration and authorized Workspace settings.

## Lifecycle and packaging

The working application remains a monolith. `packages/core`, `packages/ui`,
`packages/config`, and `packages/cli` are the stable packaging direction, while
the root runtime remains the executable reference. `scripts/core-*` provide
portable `pack`, `init`, `doctor`, `diff`, and `update` behavior based on a
manifest. They do not write checkout paths or local dependency URLs into a
consumer.

`@saas-core/app` carries the materialized application template used by
`saas-core init`; `@saas-core/cli` includes the same template when distributed
as a standalone package. A generated Projects consumer therefore receives the
actual auth, Workspace, Team, Plan, Setup, Settings, PWA, domains, Platform
Control, and source-derived interaction surfaces. It has a generic Workspace
plus Projects model and does not require industry-specific concepts to boot.
