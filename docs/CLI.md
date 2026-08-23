# CLI

The `saas-core` command is shipped by `@sapienx/saas-core` and also exposed by
the `@sapienx/saas-core-cli` package.

`init` is conflict-safe and writes only absent files. `.saas-core.json` stores
the Core version, schema version, enabled modules, provider selections and
ownership-aware hashes for managed files. It creates a complete Next.js App
Router application, not only package metadata.

`update` compares the installed manifest with the current generated contract,
makes a recoverable `.saas-core-backup/<timestamp>` checkpoint, updates only
unmodified managed files and reports conflicts. `--dry-run` reports the same
changes without writing. It never rewrites product-owned files or applies a
remote database migration automatically; migration application remains an
ordered Supabase operation.

`doctor` reports checks without printing secret values and marks missing
credentials as `NOT CONFIGURED`, not `PASS`. `diff` classifies managed-file,
user-owned-file and package-version drift. `info` is safe for support
diagnostics. `test` validates the installed project contract and can be
extended by products.
