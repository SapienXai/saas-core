# @sapienx/saas-core-cli

Current package release: `2.2.0`; Core schema remains `2.0`. The CLI is the
tooling boundary for the coordinated minor release and does not apply Core
database migrations.

Portable `init`, `doctor`, `diff`, and `update` commands for a SaaS Core
consumer. The CLI ships the canonical `@sapienx/saas-core-app` template at
pack time, records managed-file hashes, detects product-versus-Core ownership,
backs up safe updates, and preserves conflicts instead of overwriting them.

For local multi-repository development, `diff` and `update` accept an explicit
Core repository or template source:

```bash
saas-core diff ../PlaceDJ --source ../saas-core --json
saas-core update ../PlaceDJ --source ../saas-core --dry-run --json
saas-core update ../PlaceDJ --source ../saas-core
```

`--source` resolves a Core repository to `packages/app/template` (or accepts a
template directory directly). It is an explicit development-source override;
without it, the installed/packed template and normal release update semantics
are unchanged. The same manifest conflict checks, product-owned exclusions,
backup, post-update validation and rollback apply to local-source updates. When
the source is inside a Git checkout, init/update records its 40-character
`coreSourceCommit` in the consumer manifest; it records no local path and older
manifests without this optional field remain valid.

The CLI is tooling, not application runtime. Generated consumers place it in
`devDependencies`; the app package is a template carrier and is not retained
as a runtime dependency after materialization. `update` preflights the complete
plan, blocks on managed conflicts, creates an independent backup, validates
the result, and rolls back automatically if an apply or validation step fails.

`pnpm run core:pack` produces the five release tarballs used by the disposable
consumer proof. The packed CLI carries the managed billing routes, persistence,
entitlement, plan UI, and lifecycle files; a legacy consumer receives those
files during `update` while its catalog, styles, routes, migrations, and domain
files remain product-owned.
