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
