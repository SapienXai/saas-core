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
- Starter catalog: product-owned unpriced `default` plan with explicit
  `core.workspaces: 1`; no Core commercial catalog is assumed
- Schema verification: private metadata plus service-role-only doctor check
- Lifecycle: manifest-aware diff, conflict-blocking update, independent backup,
  validation, rollback, and dry-run
- Product shell: optional safe `/app/*` home and first-level navigation,
  shared by expanded, collapsed, and mobile navigation with Core route guards
- Portability: packed registry consumer, relocation, frozen reinstall
- Security: RLS, membership tenancy, platform separation, and secret boundary
  checks remain part of the release suite
- Public Workspace routing: shared trusted hostname extraction, hosted/custom
  resolution, canonical app ownership, reserved system paths, and fail-closed
  normalized pathname handling
- Auth/onboarding: root entry, destination-aware confirmation, atomic initial
  Workspace setup, invited-member bypass, platform-owner readiness, and safe
  product setup handoff are covered by source and browser checks

Intentionally deferred after 2.0: interaction-framework redesign, Motion
migration, AST/three-way merges, automatic ReserveVia migration, plugin/runtime
module registries, and advanced multi-provider billing abstraction.
