# Upgrading

SaaS Core 2.0 is a new source and schema baseline, not a minor UI release.
The old SaaS Core implementation is preserved locally on
`archive/pre-reservevia-rebuild`; the production ReserveVia checkout remains
the read-only canonical source used for extraction.

## Core/product ownership

Keep Core-owned files and product-owned files separate. A normal product
extension is not an update conflict. A Core update should report changes to
authentication, Workspace authorization, billing, delivery, PWA, platform,
and shared UI files without overwriting product routes or migrations.

Before accepting an update:

```bash
pnpm doctor -- ./my-product
pnpm diff -- ./my-product
pnpm update -- ./my-product
```

When both repositories are checked out locally, point the existing lifecycle
tool at the canonical Core source instead of publishing packages first:

```bash
node ../saas-core/packages/cli/bin/saas-core.mjs diff ../PlaceDJ --source ../saas-core --json
node ../saas-core/packages/cli/bin/saas-core.mjs update ../PlaceDJ --source ../saas-core --dry-run --json
node ../saas-core/packages/cli/bin/saas-core.mjs update ../PlaceDJ --source ../saas-core
```

The `--source` flag is a local-development override. It accepts a Core
repository (resolving `packages/app/template`) or a template directory and
does not alter release installation semantics. The command still reads the
consumer manifest, blocks locally modified managed files, preserves every
product-owned path, creates the normal backup and runs the normal validation
and rollback path. It does not apply database migrations or rewrite a lockfile.
When the source is a Git checkout, the update records only its 40-character
`coreSourceCommit` in the manifest, never the local filesystem path. This is
an optional field, so older manifests remain backward-compatible; a direct
template directory or packed release has no Git SHA to record.

`saas-core diff` compares the consumer against the managed-file hashes from
its manifest and reports Core, version, package, schema, and ignored product
changes separately. `saas-core update --dry-run` plans additions,
replacements, removals, package changes, and conflicts without mutation.
Untouched managed files are backed up and replaced; locally modified managed
files block the entire update and are reported as conflicts. A real update
preflights every source and destination, creates a complete independent backup
under `.saas-core-backups/`, applies the plan, validates the result, and
automatically restores the prior Core state if any post-mutation step fails.
The report includes the backup path and rollback result. Package versions are
updated in `package.json`; the CLI does not rewrite a consumer lockfile, so
run the consumer package manager without frozen-lockfile mode after an update
before committing a lockfile change.

The updater never partially applies a plan when a conflict is present. Its
failure path restores replaced and removed managed files, `package.json`, and
`.saas-core-manifest.json`, and removes newly added Core files. A rollback
failure is reported as critical with both error messages and the independent
backup path; the CLI does not claim a healthy consumer in that case.

The `PRODUCT_CONFIG.shell` field is optional and product-owned. Consumers that
predate the shell extension continue using the Core Workspace dashboard;
updates add the managed resolver without overwriting `lib/product-config.ts`.
If a product adopts the extension, keep its routes under the product-owned
route boundary and do not claim Core-reserved `/app` paths.

Product-wide auth and management branding belongs in the product-owned
`styles/product-theme.css`, which the root layout loads after the managed
`styles/core-lilac.css`. Keep the file to token overrides and small extension
selectors; do not edit Core-managed auth/manage components or duplicate the
Core stylesheet. `styles/product.css` remains for product-route-only styles.

## Agent Surface update

Core updates add the managed Agent Surface files and preserve product-owned
configuration, routes, styles, capabilities, and migrations. Existing products
do not need a configuration switch or product tool registry merely to accept
the update. The new foundation is available but registers zero tools until a
product page explicitly renders `CoreWebMcpTools` with product-owned tools.

The update adds no database migration and keeps Core schema `2.0`. Validate
the normal lifecycle before applying it:

```bash
node packages/cli/bin/saas-core.mjs diff ../product --source . --json
node packages/cli/bin/saas-core.mjs update ../product --source . --dry-run --json
```

The dry run should classify the Agent Surface files as Core-managed additions
or replacements. A locally changed managed Agent Surface file must still block
the entire update, and a failed apply must still roll back the prior consumer
state.

Review the generated manifest and run the product’s install, typecheck, test,
and build commands. Do not copy local `.env` files, `.next`, `node_modules`,
screenshots, or provider credentials between checkouts.

## Database changes

The baseline migration is clean and independent. New Core migrations must
contain only generic platform changes. Product migrations follow it and add
Workspace-scoped tables with RLS. Never point a clean Core reset at a live
ReserveVia database, and never rewrite the source product’s migration history.

For every schema update:

1. reset local Supabase from zero;
2. verify RLS and the public table boundary;
3. run cross-Workspace and role tests;
4. run type generation, unit tests, browser smoke tests, and a production
   build;
5. scan the generated consumer for absolute paths, `file:` dependencies, and
   product vocabulary.

Core runtime version and Core schema version are separate compatibility
coordinates. The current runtime is `2.1.0` and the Core schema remains `2.0`;
the Agent Surface capability required a backward-compatible minor package
release, not a schema migration. `doctor` verifies the actual database metadata when `SUPABASE_URL` and a server-only
`SUPABASE_SERVICE_ROLE_KEY` are available, and reports a warning when those
credentials are absent. It reports an error when metadata is missing or
mismatched. Changing a product catalog, default plan, or usage metric does not
require a Core migration.

## Public Workspace routing

Public Workspace routing is a Core runtime boundary, not a product entity
router. Products may use `resolvePublicWorkspaceRequest()` from server code to
receive a resolved Workspace plus normalized pathname, then resolve their own
domain entity. Keep product route meaning and data in product-owned files.

The canonical request-host extractor and `classifyHostname()` are shared by
proxy and public resolution. Do not add a second tenant-host parser, query
parameter override, or provider lookup to a page request. A future Core update
must preserve `lib/domains/hostname.ts`, `lib/route-ownership.ts`, and
`lib/public-workspace.ts` as managed files. If a product customizes public
paths, it must not claim Core canonical app paths or system/static paths.

Development hostname behavior is also centralized there: use `localhost` for
simple local work and `<private-ip>.nip.io` forms when testing root, app, or
Workspace host semantics. Keep nip.io separate from ngrok tunnels and do not
persist nip.io aliases as customer domains.

The schema remains Core `2.0`; this capability uses the existing `workspaces`
and `workspace_domains` tables and adds no migration or product-entity table.
Domain provider reconciliation remains in the existing management workflow.

## UI changes

Preserve source-derived implementations when moving shared components. A
small import/type diff is preferred. Check pending action sizing, focus
restoration, Escape/outside dismissal, portal theme, sidebar persistence,
mobile Sheet behavior, safe areas, reduced motion, and 390px overflow before
merging an update.

## Release discipline

Create a local checkpoint commit for each coherent phase. Do not push archive
branches or release artifacts automatically. The final release should include
`pnpm install --frozen-lockfile`, lint, typecheck, unit tests, clean DB tests,
browser tests, build, `pnpm pack`, a fresh consumer, relocation, and a second
frozen install/build.
