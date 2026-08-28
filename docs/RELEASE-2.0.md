# SaaS Core 2.0.0 release freeze

Status: verified for local freeze; this checklist records only
repository-backed checks. No external package publication or push is implied.

- Runtime version: `2.0.0`
- Core schema version: `2.0`
- Canonical template: `packages/app/template`
- ReserveVia extraction source: `e12566a6792c7144f576459e17b9ddce94de9e55`
- Package namespace: `@sapienx`
- Packages: Core contracts, config, UI, app template carrier, CLI
- UI fidelity: 52 source-derived primitives guarded by `core:ui-fidelity`
- Commercial genericity: product-owned plan catalog and keyed usage metrics
- Default plan: persisted server-side through catalog sync; future workspace
  bootstrap only
- Schema verification: private metadata plus service-role-only doctor check
- Lifecycle: manifest-aware diff, conflict-blocking update, independent backup,
  validation, rollback, and dry-run
- Portability: packed registry consumer, relocation, frozen reinstall
- Security: RLS, membership tenancy, platform separation, and secret boundary
  checks remain part of the release suite

Intentionally deferred after 2.0: interaction-framework redesign, Motion
migration, AST/three-way merges, automatic ReserveVia migration, plugin/runtime
module registries, and advanced multi-provider billing abstraction.
