# Upgrading

Run `saas-core doctor`, inspect `saas-core diff`, then `saas-core update`.
Update creates a backup of managed files and updates compatibility metadata.
Apply Core migrations through the product's normal Supabase pipeline, verify
schema version, run typecheck/integration tests and only then deploy.

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
