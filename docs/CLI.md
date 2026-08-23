# CLI

The `saas-core` command is shipped by `@sapienx/saas-core` and also exposed by
the `@sapienx/saas-core-cli` package.

`init` is conflict-safe and writes only absent files. `.saas-core.json` stores
the Core version, schema version, enabled modules and hashes for managed files.
`update` makes a recoverable `.saas-core-backup/<timestamp>` copy before
changing metadata. It never rewrites product-owned files or applies a remote
database migration automatically.

`doctor` reports checks without printing secret values. `diff` detects only
managed baseline drift. `info` is safe for support diagnostics. `test` validates
the installed project contract and can be extended by products.
