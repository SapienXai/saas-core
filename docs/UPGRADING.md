# Upgrading

Run `saas-core doctor`, inspect `saas-core diff`, then `saas-core update`.
Update creates a backup of managed files and updates compatibility metadata.
Apply Core migrations through the product's normal Supabase pipeline, verify
schema version, run typecheck/integration tests and only then deploy.

Generated product-owned files are not silently overwritten. Resolve conflicts
manually and rerun `saas-core diff`.
