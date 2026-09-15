# SaaS Core agent contract

This repository is the reusable Core platform and canonical source for the
consumer application template. Read this file before editing. Keep product
domain concepts, product tables, product routes, catalog copy and provider
commercial policy in the consumer boundary.

## Reading order

1. [`docs/START-HERE.md`](docs/START-HERE.md) for the maintainer or consumer
   journey.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the runtime boundary.
3. [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md) for the update contract.
4. [`docs/DATABASE.md`](docs/DATABASE.md) and [`docs/SECURITY.md`](docs/SECURITY.md)
   before changing migrations, RLS, privileges or server-only code.
5. [`docs/UPGRADING.md`](docs/UPGRADING.md) and the current release note before
   changing packaging, manifests or CLI lifecycle behavior.

## Source and ownership

- `packages/app/template` is the canonical packed application source.
- The root app is the executable Core reference and must stay byte-for-byte
  aligned with the template for Core-managed artifacts.
- `packages/cli/bin/ownership.mjs` is the executable ownership contract used by
  init, doctor, diff, update and the parity check.
- Core-managed files include the shared auth, Workspace, membership,
  authorization, billing, entitlement, Platform, PWA, domains, email, push,
  agent-surface, UI and direct Core migration sources.
- Product-owned paths are the product prefixes and exact files in
  [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md), including product migrations,
  product config/catalog/styles, consumer docs/env and generated
  `types/supabase.ts`.
- `package.json` is mixed: consumer scripts and dependencies are preserved;
  the CLI owns only the four Core package coordinates.

Use the practical rule: if a capability still makes sense without knowing the
product's domain, it is probably Core. If it names a product resource or
commercial decision, add a product-owned extension or propose a reusable Core
contract instead of coupling Core to it.

## Non-negotiable boundaries

- Keep authorization in server actions, route handlers and database policies;
  a hidden link or client-side check is not a tenancy boundary.
- Keep RLS enabled for every exposed table. Use explicit roles, workspace
  foreign keys, indexes and restrictive policies. Follow the recipe in
  `docs/DATABASE.md`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, provider secrets, webhook secrets
  or private-schema operations to browser code or `NEXT_PUBLIC_*` variables.
- Missing, stale, canceled, paused, expired, unknown or malformed paid state
  must use a restrictive configured fallback; absence must never imply
  unlimited access.
- Core migrations are source-only delivery. The CLI must not execute SQL,
  reset a consumer database or overwrite `supabase/migrations/product/**`.
- Preserve unrelated checkout work. Do not reset, discard, blindly stash,
  force-push, merge, deploy, publish or mutate production as part of a local
  code task unless that action is separately authorized.

## Verification contract

Run the smallest relevant check while iterating. Before handing off a Core or
template change, prefer this source contract:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:run
pnpm core:source-parity
pnpm core:consumer-contract
```

For schema work with local Supabase available, also run `pnpm db:reset`,
`pnpm db:types`, `pnpm db:test:schema` and the focused database test. The
broader `pnpm release:check` includes local integration, packaging and release
proofs. Restore generated-only `next-env.d.ts` drift after build checks when
the build changes it.

Report separately: source validation, database validation, package/registry
verification and any skipped or stale certification evidence. Do not call a
source copy a database migration or a local build a public release.

## Consumer lifecycle

`saas-core init` materializes the template and writes a dynamic consumer
`README.md`, `AGENTS.md`, `.env.example`, manifest, product config/catalog,
usage extension and package scripts. `doctor` checks source, package,
consumer-contract and database readiness. `diff` shows Core drift, package and
version movement while preserving product changes. `update` plans additions,
replacements, removals, backup, conflict blocking and rollback; it never
silently merges a modified Core-managed file.

When changing this lifecycle, update the executable ownership module, parity
check, lifecycle/consumer proofs and the user-facing docs together.

## Release identity

The coordinated package/runtime release is currently `2.5.0`; the schema
compatibility coordinate is `2.0`. The `saas-core-v2.5.0` tag is the release
anchor, while `main` may contain post-tag unreleased fixes. Confirm exact
identity from `package.json`, `scripts/release-constants.mjs`, package
manifests, tags and registry checks. Keep runtime/package version and schema
compatibility as separate coordinates in every report.

## Next.js 16 guidance

This project uses Next.js 16. Its APIs and conventions can differ from older
Next.js versions. Before changing routing, layouts, proxy or server actions,
read the relevant guide in `node_modules/next/dist/docs/`. Keep authentication
and authorization inside the server action or handler; `proxy.ts` is an early
request boundary, not a replacement for authorization.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
