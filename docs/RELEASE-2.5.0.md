# SaaS Core 2.5.0 release candidate

This release candidate prepares the downgrade-hardening work introduced after
the `0bc930f` Core baseline for a coordinated SaaS Core `2.5.0` release. The
runtime, five package manifests, managed application template, and CLI share
the `2.5.0` coordinate. Core schema compatibility intentionally remains `2.0`;
no schema-coordinate bump is required for this additive policy layer.

## Highlights

- The provider-neutral Core package exports the typed
  `PlanChangeEligibility` contract and `evaluatePlanChangeEligibility()`.
- The managed server entitlement layer resolves target-plan limits against
  authoritative Core and product usage. Missing configuration and unavailable
  usage fail closed; only explicit `null` is unlimited.
- Paddle downgrade preview checks eligibility and confirmation revalidates it
  immediately before scheduling or calling the provider mutation. Upgrades
  remain unaffected, and cancellation remains available when usage exceeds a
  fallback limit.
- The managed billing UI reports dynamic target-plan violations without
  turning an ineligible downgrade into a confirmable provider action.
- The canonical template and CLI continue to carry the additive Core-managed
  migration sources, including
  `20260914110000_fix_renew_workspace_invitation.sql`.

## Package versions

| Package | Version |
| --- | --- |
| `@sapienx/saas-core` | `2.5.0` |
| `@sapienx/saas-core-config` | `2.5.0` |
| `@sapienx/saas-core-ui` | `2.5.0` |
| `@sapienx/saas-core-app` | `2.5.0` |
| `@sapienx/saas-core-cli` | `2.5.0` |

## Schema and consumer delivery

The release remains additive and keeps schema compatibility coordinate `2.0`.
Core packages and the CLI deliver migration source only; they never execute a
consumer migration. The managed set includes:

- `supabase/migrations/20260909094344_reusable_billing_persistence.sql`
- `supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`
- `supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`
- `supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql`

Products define their own commercial limits and product usage resolvers. A
consumer must apply and verify these sources through its controlled database
workflow, preserve product-owned files, and use the server-side eligibility
contract before offering an explicit downgrade.

## Scope

This is a SaaS Core release candidate only. It does not publish, push, tag,
deploy, or modify PlaceDJ or ReserveVia, and it does not define consumer
commercial limits or apply consumer migrations.
