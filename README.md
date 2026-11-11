# SaaS Core

Build the product customers remember on top of the Workspace platform every
SaaS needs.

SaaS Core is a Next.js and PostgreSQL foundation for products
that need authenticated accounts, multi-workspace tenancy, membership and
roles, server-backed entitlements, billing persistence, workspace-owned
domains, PWA, email, push, Platform administration and an agent surface. A
product receives the real application shell and consumes Core's canonical
`hostname → Domain → PublicSite → Workspace → productKey` contract; it does
not own hostname mappings.

> The latest published release is `2.8.0` at tag `saas-core-v2.8.0`.
> The Core schema compatibility coordinate is `2.0`. Clean installations can
> use Neon for accounts, sessions and application data. Existing Supabase
> consumers can retain their backend until they plan their data migration.

## The shape of the platform

```mermaid
flowchart LR
  Browser[Browser] --> Product[Product experience]
  Product --> Shell[Core management shell]
  Shell --> Auth[Better Auth on Neon or Supabase Auth]
  Shell --> Tenant[Workspace tenancy and roles]
  Tenant --> RLS[(Postgres + RLS)]
  RLS --> Domain[Core public domains and product tables]
  Shell --> Services[Billing, domains, PWA, email, push]
```

Core owns the reusable Workspace and public-domain boundaries. Products add
routes, product tables, catalog meaning and product UX without forking
hostname ownership, tenancy or security infrastructure.

## What you get

| Foundation | Product-ready surface |
| --- | --- |
| Authentication and session-aware routing on Neon or Supabase | A complete Next.js app template |
| Workspace creation, switching, membership and roles | Auth, onboarding and management screens |
| Server-side authorization and Postgres RLS primitives | Plan, entitlement and usage surfaces |
| Durable billing and webhook persistence boundaries | PWA, domains, email and push configuration |
| Platform operator boundary and audit surfaces | Agent/WebMCP contracts and shared UI |
| Source-only migrations and conflict-aware lifecycle CLI | A dynamic consumer README, AGENTS contract and local bootstrap scripts |

The template is portable source, not a runtime dependency. The CLI materializes
it into the product repository and records a manifest of Core-managed hashes.

## Build a product

Create a consumer from the published template:

```bash
pnpm dlx @sapienx/saas-core-cli@2.8.0 init "My Product" ./my-product
cd my-product
pnpm install
cp .env.example .env.local
```

Follow [Neon setup](docs/NEON.md) to configure the database, auth and data
endpoint, then run `pnpm dev`. For an existing Supabase consumer, use the
backend and database workflow already configured in that project.

`init` creates the product-specific `README.md`, `AGENTS.md`, `.env.example`,
`.gitignore`, `package.json`, manifest, neutral starter catalog and server-only usage
extension. It also includes runnable `lint`, `typecheck`, test, local DB,
catalog sync, verification and Core lifecycle scripts.

Product code normally lives here:

```text
my-product/
├── app/(product)/app/          # product workspace routes
├── components/product/        # product UI
├── lib/product-config.ts      # identity, home and navigation
├── product.catalog.json       # plans, limits and usage metrics
├── src/product/usage.ts       # server-only usage resolvers
├── supabase/migrations/product # product-owned migrations
└── types/supabase.ts          # generated product-aware types
```

Use [`docs/START-HERE.md`](docs/START-HERE.md) for both the Core-maintainer
and product-consumer journeys.

## Database boundary

Tenant-owned product rows must carry a `workspace_id` foreign key, an index and
explicit RLS policies. Core tables, private settings, billing persistence,
Platform tables and email outbox state are not product tables. Product-owned
SQL migrations are direct children of `supabase/migrations/`.

The CLI copies and hashes Core migration source; it never runs SQL, resets a
database or overwrites a product migration. Apply migrations through the
consumer's chosen backend workflow. Supabase consumers regenerate and review
`types/supabase.ts` after schema changes.

See [`docs/DATABASE.md`](docs/DATABASE.md) for the model, table inventory, RLS
principles and a safe first-table recipe.

## Ownership and updates

| Core owns | Product owns | Mixed |
| --- | --- | --- |
| Auth, Workspace, membership, authorization, billing, entitlements, Platform, PWA, public-domain mappings, email, push, agent surface, shared UI and direct Core migrations | Product routes, product tables, catalog, product styles, product migrations, consumer docs/env and generated Supabase types | `package.json`: product metadata/scripts remain; CLI updates only the four Core package coordinates |

Inspect before changing a consumer:

```bash
pnpm exec saas-core diff . --json
pnpm exec saas-core update . --dry-run --json
pnpm exec saas-core update .
pnpm db:reset
pnpm db:types
pnpm verify
```

Modified Core-managed files produce conflicts and are not silently replaced.
Product files are preserved. A copied migration is still unapplied source;
database readiness is verified separately by `doctor` when server credentials
are available.

Read [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md) for the executable path contract
and update behavior.

## Maintainer verification

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:run
pnpm core:source-parity
pnpm core:consumer-contract
```

The source contract is deliberately useful without provider credentials. With
local Supabase, add `pnpm db:start`, `pnpm db:reset`, `pnpm db:types`,
`pnpm db:test:schema` and `pnpm db:test:clean`. The full release gate also
covers package tarballs, lifecycle updates, local integration and consumer
proof; it does not publish or deploy by itself.

## Repository hygiene

Git contains canonical source, deterministic fixtures, package metadata,
release workflows, documentation and the intentionally versioned generated
contracts `next-env.d.ts` and `types/supabase.ts`. It does not contain
dependency installs, Next/Turbo/build output, browser state, local Supabase
state, package tarballs, logs, credentials, editor state or temporary proof
directories. The root `.gitignore` and generated consumer `.gitignore` are
deliberate contracts, not a substitute for ownership review.

Run the focused guard and its failure-path test with:

```bash
pnpm repo:hygiene
pnpm repo:hygiene:test
```

`repo:hygiene` reads tracked paths from Git, rejects known generated/runtime
locations, conservative high-confidence secrets (including in example env and
Markdown files), local package references and tracked files above the 1 MiB
guard. Clearly placeholder-shaped token values are tolerated without exempting
the file from scanning. `pnpm verify` runs both checks before lint,
typecheck, tests, root/template parity and the fresh consumer contract. Package
packing writes five disposable tarballs under ignored `artifacts/`; the
artifact audit confirms the intended runtime/template files and the explicit
source-map policy before a release can proceed.

## Guides

- [Start here](docs/START-HERE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Ownership contract](docs/OWNERSHIP.md)
- [Database and RLS](docs/DATABASE.md)
- [Product integration](docs/PRODUCT-INTEGRATION.md)
- [Plan catalog](docs/PLAN-CATALOG.md)
- [Billing architecture](docs/BILLING-ARCHITECTURE.md)
- [Agent surface](docs/AGENT-SURFACE.md)
- [Security](docs/SECURITY.md)
- [UI system](docs/UI-SYSTEM.md)
- [Consumer upgrades](docs/UPGRADING.md)
- [Neon setup](docs/NEON.md)
- [Latest published release](docs/RELEASE-2.8.0.md)

## Principles

Core provides the hard-to-rebuild platform boundary. Products provide the
reason to use it. Keep those responsibilities visible in code, in the
database and in every update report.
