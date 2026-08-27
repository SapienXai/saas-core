# Upgrading

Run `saas-core doctor`, inspect `saas-core diff`, then `saas-core update`.
Update creates a backup of managed files and updates compatibility metadata.
Apply Core migrations through the product's normal Supabase pipeline, verify
schema version, run typecheck/integration tests and only then deploy.

## v1.1.2 to v1.2.0

This is a runtime and generated-application contract release. It keeps database
schema `1.3.1`; no new Supabase migration is required. The UI package is now a
modular published foundation with package-owned CSS, explicit subpath exports,
theme tokens, generic shell/default views and a compatibility facade for the
1.1.x UI exports.

The updater converts the generated default presentation to product ownership:

- untouched default `globals.css`, auth, shell and app presentation migrate to
  the new package CSS/theme/navigation files and obsolete default CSS is backed
  up and removed;
- changed presentation is preserved and reported as a product-presentation
  conflict rather than overwritten;
- `saas.theme.json`, `src/styles/product.css`, `src/theme/config.ts`,
  `src/product/navigation.ts` and product routes are never Core-managed;
- Core package dependencies remain portable version ranges and unrelated
  product dependencies/overrides are preserved.

For an installed product, review the dry run and then run:

```bash
saas-core update --dry-run
saas-core update
saas-core customize --mode system
pnpm install
saas-core doctor
saas-core diff
saas-core test
```

If a customized legacy `src/app/globals.css` remains, it is reclassified as a
product-owned file. Move its intentional rules into `src/styles/product.css`
when convenient; the backup under `.saas-core-backup/` is recoverable.

## v1.1.0 to v1.1.1

This release adds the additive `20260824040000_v111_platform_operations.sql`
migration and advances the manifest schema to `1.3.1`. It adds canonical
platform capability enforcement, audited operator mutations, filtered
attention queries and provider reconciliation boundaries. Do not edit or
remove the earlier migration; apply the new migration through the normal
Supabase migration pipeline, then run `saas-core doctor`, `saas-core diff`,
and `pnpm release:verify` before deployment.

Generated product-owned files are not silently overwritten. Resolve conflicts
manually and rerun `saas-core diff`.

## v1.1.1 to v1.1.2

This patch has no database migration and keeps schema version `1.3.1`. It fixes
the generator so new products always receive portable `^1.1.2` Core package
specifications. It also makes `saas-core update` replace known Core package
`file:` specs and remove matching Core overrides left by affected v1.1.1
products; unrelated dependencies and pnpm overrides are preserved.

For an affected product, review and run:

```bash
saas-core update --dry-run
saas-core update
pnpm install
saas-core diff
saas-core test
```

Resolve any reported managed-file conflicts before installation. No local Core
checkout path should remain in `package.json`, `pnpm-lock.yaml` or generated
configuration. `SAAS_CORE_TARBALL_DIR` is not a product migration mechanism;
it is reserved for the Core release and acceptance harness.

## v1.1.1 to v1.2.0

The direct compatibility path includes both the v1.1.2 portable dependency
normalization and the v1.2.0 UI ownership migration. It keeps schema `1.3.1`
and preserves unrelated product dependencies and overrides. Run the same
`update --dry-run` review followed by `update`, install, diagnostics and build.
The updater recognizes old `file:` Core package specs while it migrates the
old managed presentation, so an intermediate manual 1.1.2 upgrade is not
required.
