# Ownership contract

This is the source-of-truth explanation for what a SaaS Core update may
change. The executable list lives in
[`packages/cli/bin/ownership.mjs`](../packages/cli/bin/ownership.mjs); the
parity check and the lifecycle CLI use that module directly.

## Core-managed

The canonical source is [`packages/app/template`](../packages/app/template).
Every template file that is not ignored or product-owned is Core-managed and
is copied into a new consumer, recorded by content hash, and eligible for a
conflict-aware `saas-core update`.

That includes the reusable application shell and its auth, Workspace,
membership, role/authorization, billing, entitlement, Platform, PWA, domain,
email, push, agent-surface and shared UI capabilities. Direct SQL files under
`supabase/migrations/*.sql` are Core migration sources. The template also
ships the generic local-type and catalog-sync helpers.

The CLI never applies those SQL files. A consumer decides when and how to run
`supabase db reset`, migration application, type generation and database
tests.

## Product-owned

These prefixes and exact paths are the CLI contract:

| Kind | Paths |
| --- | --- |
| Prefixes | `src/product/`, `app/(product)/`, `app/product/`, `components/product/`, `supabase/migrations/product/` |
| Identity and catalog | `lib/product-config.ts`, `product.catalog.json` |
| Product entry and styling | `app/page.tsx`, `app/manage/page.tsx`, `styles/product-theme.css`, `styles/product.css`, `public/product-*` |
| Product database inputs | `supabase/migrations/product/**`, `supabase/seed.sql`, `supabase/config.toml` |
| Consumer contract | `README.md`, `AGENTS.md`, `.env.example` |
| Generated schema view | `types/supabase.ts` |

The generated type snapshot is product-owned because a product's own tables
must be visible after `pnpm db:types`. Core runtime files may import its Core
aliases, but an update must not erase product table types. Regenerate it after
controlled schema changes and review the diff.

Product-owned changes are reported as preserved/ignored changes by the CLI.
They are not written to the manifest's managed hash set, and product
migrations remain safe when Core is updated.

## Mixed files and ignored files

`package.json` is mixed ownership. `init` creates the complete consumer
package; `update` changes only the four Core package coordinates:

- runtime: `@sapienx/saas-core`, `@sapienx/saas-core-config`,
  `@sapienx/saas-core-ui`
- tooling: `@sapienx/saas-core-cli`

Product scripts, dependencies, package name and consumer metadata remain
theirs. `next-env.d.ts`, lockfiles, `.gitignore`, `.saas-core-manifest.json`,
Next build output, local package registries and Supabase temporary state are
ignored operational files. A fresh consumer gets `.gitignore` from the
canonical `packages/app/template/consumer.gitignore` source; Core creates it
only when missing and does not overwrite a consumer's local policy.

## Why root and template are duplicated

The root app is the runnable Core reference and `packages/app/template` is the
inspectable, publishable application source. Their Core-managed application,
authorization, billing, configuration, UI, tooling and direct migration
surfaces are intentionally duplicated so each can be run and packed in its own
context. `scripts/check-app-template-parity.mjs` compares them byte-for-byte,
uses this module's ownership exclusions and reports the direct migration count.

The repository does not generate the application through a broad codegen step:
that would hide reviewable source and complicate package portability. Product
routes, catalog, styles, product migrations, consumer docs/env and generated
product-aware types remain intentionally different and protected by the same
ownership contract.

## Git and package hygiene

The root `.gitignore` protects Core development and release output. The
consumer ignore contract covers dependency installs, Next/Turbo/build output,
browser evidence, local Supabase state, package tarballs, logs, credentials,
editor state and temporary files. `repo:hygiene` checks the Git tracked set,
not merely the filesystem, and applies a 1 MiB tracked-file guard. Its
high-confidence secret checks also scan example environment files and
documentation; only clearly placeholder-shaped token suffixes are tolerated,
while the report contains the path and category but never the credential value.
Generic source names such as `tests/playwright`, `src/build`, `src/output`,
`src/tmp` and `src/artifacts` are not rejected; only known runtime locations
and root/package output locations are blocked. The reviewed large-file
allowlist is currently empty; a future exception must name one exact path.

Core/config/UI `dist` source maps are intentionally produced at pack time and
shipped because their package exports point to those runtime/declaration files.
Application and CLI tarballs ship the template contract, migration source and
the two deterministic template tests only; browser output, local config and
temporary package state are not package contents. `release:packages` inspects
all five publishable tarballs.

## Practical rule

If a capability still makes sense without knowing the product's domain, it is
probably Core. If it names a product resource, owns commercial copy, adds a
tenant table or changes product navigation, it belongs behind a product-owned
boundary. When a reusable capability is missing, propose it as a Core change;
do not patch a Core-managed file with a product-specific shortcut.

## Update sequence

```bash
pnpm exec saas-core diff . --json
pnpm exec saas-core update . --dry-run --json
pnpm exec saas-core update .
pnpm db:reset
pnpm db:types
pnpm verify
```

Resolve a managed conflict explicitly before applying an update. A successful
copy is not evidence that the consumer database has run the new SQL.
