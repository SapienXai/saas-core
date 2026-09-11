# SaaS Core 2.2.1 release

This is the first registry-oriented patch release after the repository-backed
2.2.0 boundary. The coordinated packages, tag, and consumer manifest all use
`2.2.1`; Core schema compatibility remains `2.0`.

## Highlights

- Root application and canonical `packages/app/template` Platform Users
  surfaces are synchronized, and CLI packing fails if that boundary drifts.
- Hosted and custom public Workspace routing uses the configured root domain in
  integration fixtures, preserves trusted-host classification, ignores tenant
  query/path overrides, and keeps canonical Core routes off tenant hosts.
- A single `pnpm release:check` gate covers frozen install, lint, typecheck,
  unit/integration/schema checks, Core scans, build, package packing, tarball
  inspection, and fresh/upgrade/relocation consumer proof.
- The five package tarballs are checked for clean contents and resolved
  registry dependency ranges before publication.

## Package versions

| Package | Version |
| --- | --- |
| `@sapienx/saas-core` | `2.2.1` |
| `@sapienx/saas-core-config` | `2.2.1` |
| `@sapienx/saas-core-ui` | `2.2.1` |
| `@sapienx/saas-core-app` | `2.2.1` |
| `@sapienx/saas-core-cli` | `2.2.1` |

## Compatibility and managed migrations

`schemaVersion` remains `2.0`. The additive Core-managed source
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` is
delivered as source and metadata only. The CLI never executes SQL; each
consumer controls migration ordering, application, verification, and database
rollback. Product catalogs, product-owned migrations, styles, custom routes,
and domain files remain outside the managed replacement set.

## CLI lifecycle and upgrade notes

The registry CLI supports `init`, `doctor`, `diff`, and `update`. A fresh
consumer installs the runtime packages and CLI from npm, initializes from the
packed template, and then runs its own install/typecheck/test/build. An upgrade
must run `doctor`, review `diff --json`, apply `update` only after conflicts are
resolved, reinstall dependencies, and apply/verify Core-managed SQL through the
consumer’s database process. Modified managed files fail closed; updates are
backed up and post-update validation failures roll back package/manifest/files.

## Breaking changes

None in the schema compatibility coordinate or the managed update ownership
model. This patch release does not replace product-owned routes, styles,
catalogs, or migrations.

## Known limitations

- The source repository is private. The release workflow intentionally uses
  explicit `npm publish --access public`; this makes package tarballs publicly
  fetchable even though the GitHub source remains private. npm scope/package
  ownership and the intended package license must be approved externally.
- The publish job is fail-closed until the repository variable
  `SAAS_CORE_PUBLIC_RELEASE_APPROVED=true` is set after that visibility/license
  decision. Each package also needs an npm Trusted Publisher entry for the
  `SapienXai/saas-core` repository and `release-saas-core.yml` workflow.
- Publication requires npm Trusted Publishing for the GitHub repository and
  workflow. No long-lived npm token is accepted by the workflow.
- Provider-secret-dependent billing mutations remain outside the deterministic
  local gate. Critical browser E2E is mandatory when Chromium is installed;
  any explicit local skip is reported and is not a release certification.

## Validation evidence

The canonical command is:

```bash
pnpm release:check
```

It proves source/template parity, the five clean tarballs, package dependency
resolution without workspace/local paths, fresh packed-registry initialization,
the `2.2.0 → 2.2.1` update, managed conflict safety, backup/rollback,
product-owned preservation, consumer relocation, frozen reinstall, doctor,
tests, and build.

## Install and update

```bash
pnpm add @sapienx/saas-core@^2.2.1 @sapienx/saas-core-config@^2.2.1 @sapienx/saas-core-ui@^2.2.1
pnpm add -D @sapienx/saas-core-cli@^2.2.1
pnpm exec saas-core doctor .
pnpm exec saas-core diff . --json
pnpm exec saas-core update . --dry-run --json
pnpm exec saas-core update .
pnpm install
```
