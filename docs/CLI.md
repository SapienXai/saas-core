# CLI

The `saas-core` command is shipped by `@sapienx/saas-core` and also exposed by
the `@sapienx/saas-core-cli` package.

`init` is conflict-safe and writes only absent files. `.saas-core.json` stores
the Core version, schema version, enabled modules, provider selections and
ownership-aware hashes for managed files. It creates a complete Next.js App
Router application, not only package metadata.

Interactive init presents a compact module wizard. Billing and email are
enabled by default; domains, PWA and Web Push are opt-in. Platform Control and
Core Lab are included by default. Use `--yes --non-interactive` in CI, or make
the module profile explicit with `--without-billing`, `--without-email`,
`--without-platform`, `--with-domains`, `--with-pwa` and `--with-push`.

`update` compares the installed manifest with the current generated contract,
makes a recoverable `.saas-core-backup/<timestamp>` checkpoint, updates only
unmodified managed files and reports conflicts. `--dry-run` reports the same
changes without writing. It never rewrites product-owned files or applies a
remote database migration automatically; migration application remains an
ordered Supabase operation.

`customize` edits only the product-owned `saas.theme.json` file. It supports
`--preset default|neutral|violet|blue`, `--mode light|dark|system`,
`--primary`, `--accent`, `--radius small|medium|large|full`, `--name`,
`--logo` and `--icon`; with no flags it presents a concise interactive prompt.
It never rewrites `core.config.ts`, backend routes or platform logic.

Generated `package.json` files use portable `^<Core version>` specifications
for every Core package. `SAAS_CORE_TARBALL_DIR` is a Core development harness
input only; the harness uses its packed-artifact directory for isolated
acceptance installation and it is never copied into generated files or
`pnpm.overrides`. It is not a product-install or dependency-override flag.

`doctor` reports checks without printing secret values and marks missing
credentials as `NOT CONFIGURED`, not `PASS`. `diff` classifies managed-file,
user-owned-file and package-version drift. `info` is safe for support
diagnostics and includes the selected module configuration plus the env file
source used for diagnostics. `test` validates the v1.2.0 manifest, portable
Core dependencies, published UI styles, Setup Center, Platform routes,
managed files and Core migration. `doctor` performs live Supabase checks only
when credentials are
available; provider credentials
are reported as configured-but-unverified until a provider call is made.

`pnpm release:check` is the fast deterministic gate. `pnpm release:verify` is
the authoritative local release gate: it resets the repository's local
Supabase database, runs authenticated integration tests, executes Core Lab,
installs packed packages into a temporary generated app, runs CLI diagnostics
and build, and drives the Chromium acceptance journey. It mirrors packed
artifacts into a temporary directory, serves only the `@sapienx` scope through
a temporary local registry, and verifies a copied generated app with a frozen
reinstall. It does not stop or modify another Supabase project.
