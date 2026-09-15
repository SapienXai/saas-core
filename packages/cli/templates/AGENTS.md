# __PRODUCT_NAME__ agent contract

This repository is a product built on SaaS Core. Read this file before editing
code. Product code begins at the Workspace boundary; Core already provides
authentication, Workspace tenancy, membership, roles, authorization
primitives, billing and entitlements, usage enforcement, email, PWA, push,
domains, Platform administration, the management shell and source-aware
consumer updates.

## Reading order

1. `README.md` and `.env.example` for the local journey.
2. `lib/product-config.ts`, `product.catalog.json` and `src/product/usage.ts` for
   this product's identity, navigation, plans and usage.
3. `supabase/migrations/product/` and `types/supabase.ts` for product data.
4. The upstream Core guides for architecture, database/RLS, security and
   upgrades when a change crosses the Workspace boundary.

## Ownership contract

Core-managed files are the copied application shell, auth, Workspace,
membership, authorization, billing, entitlements, Platform, PWA, domains,
email, push, direct `supabase/migrations/*.sql` files and Core helper scripts.
Product-owned files are:

- `README.md`, `AGENTS.md`, `.env.example`
- `lib/product-config.ts`, `product.catalog.json`
- `app/(product)/`, `app/product/`, `components/product/`, `src/product/`
- `app/page.tsx`, `app/manage/page.tsx`, product styles and
  `public/product-*`
- `supabase/migrations/product/**`, `supabase/seed.sql`,
  `supabase/config.toml`, `types/supabase.ts`

`package.json` is mixed ownership: keep product scripts/dependencies and let
the CLI update only Core package versions. Do not edit a Core-managed file to
make a product feature fit; add a product boundary or propose a reusable Core
capability instead.

## Product implementation rules

- Tenant-owned data has a `workspace_id` foreign key and explicit RLS.
- Use Core membership/role helpers and server actions for authorization. A
  hidden button or route check is not a tenancy boundary.
- Keep service-role clients in server-only modules and never expose their key
  through `NEXT_PUBLIC_*`.
- Put usage writes and usage resolvers behind `src/product/usage.ts`; keep
  plan keys stable and make the default plan's `core.workspaces` limit
  explicit.
- Keep provider price IDs and live billing decisions out of the generic plan
  catalog sync.
- Use the database migration workflow controlled by this product. The CLI
  delivers source and does not execute SQL.

## Verification contract

For a focused change, run the smallest relevant check. Before handoff:

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm verify
pnpm saas-core:doctor
```

After a database change, run `pnpm db:reset`, `pnpm db:types`, and a focused
RLS/database test. For an update, inspect `pnpm saas-core:diff -- --json`,
use `pnpm saas-core:update:dry-run`, resolve conflicts, then apply the
controlled migration and verify again. Never claim a database migration was
applied because `saas-core` copied its source.

## Next.js guidance

This project uses Next.js 16. Its APIs and conventions can differ from older
Next.js versions. Before changing routing, layouts, proxy or server actions,
read the relevant guide in `node_modules/next/dist/docs/`. Keep authentication
and authorization inside the server action or handler; routing middleware/proxy
is only an early request boundary.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file; in monorepos the `next` package may not be visible from the product root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
