# @sapienx/saas-core-cli

Portable `init`, `doctor`, `diff`, and `update` commands for a SaaS Core
consumer. The CLI ships the canonical `@sapienx/saas-core-app` template at
pack time, records managed-file hashes, detects product-versus-Core ownership,
backs up safe updates, and preserves conflicts instead of overwriting them.

The CLI is tooling, not application runtime. Generated consumers place it in
`devDependencies`; the app package is a template carrier and is not retained
as a runtime dependency after materialization. `update` preflights the complete
plan, blocks on managed conflicts, creates an independent backup, validates
the result, and rolls back automatically if an apply or validation step fails.
